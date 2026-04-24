(function () {
  "use strict";

  var RUNTIME_KEY = "__dvPathRuntimeActive";
  var RUNTIME_COUNTER_KEY = "__dvPathRuntimeInstanceCount";
  var RUNTIME_VERSION = "2026.04.24-webstudio-modes-1";
  var PATH_ATTR = "dv-path";
  var PATH_ATTR_ALT = "dv_path";
  var REVEAL_ATTR = "dv-reveal";
  var REVEAL_READY_FLAG = "dvRevealReady";
  var OBSERVER_READY_FLAG = "dvPathObserverReady";
  var GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";
  var SCROLL_TRIGGER_URL =
    "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/ScrollTrigger.min.js";
  var PATH_CONTROLLER_ATTRS = [
    PATH_ATTR,
    PATH_ATTR_ALT,
    "dv-path-mode",
    "dv_path_mode",
    "dv-path-from",
    "dv_path_from",
    "dv-path-to",
    "dv_path_to",
    "dv-path-duration",
    "dv_path_duration",
    "dv-path-repeat",
    "dv_path_repeat",
    "dv-path-scrub",
    "dv_path_scrub",
    "dv-path-trigger",
    "dv_path_trigger",
    "dv-path-start",
    "dv_path_start",
    "dv-path-end",
    "dv_path_end",
    "dv-path-gradient",
    "dv_path_gradient",
    "dv-path-gradient-duration",
    "dv_path_gradient_duration",
    "dv-path-gradient-center",
    "dv_path_gradient_center",
    "dv-path-debug",
    "dv_path_debug",
    "d"
  ];
  var REVEAL_ATTRS = [
    REVEAL_ATTR,
    "dv-reveal-y",
    "dv-reveal-duration",
    "dv-reveal-delay",
    "dv-reveal-start",
    "dv-reveal-once",
    "dv-reveal-stagger"
  ];
  var PATH_CONTROLLERS = new WeakMap();
  var ACTIVE_PATHS = new Set();
  var DUPLICATE_WARNINGS = {};

  if (window[RUNTIME_KEY] === true) {
    return;
  }

  window[RUNTIME_KEY] = true;
  window[RUNTIME_COUNTER_KEY] = (window[RUNTIME_COUNTER_KEY] || 0) + 1;

  var RUNTIME_INSTANCE_ID = "dv-path-runtime-" + window[RUNTIME_COUNTER_KEY];

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[src="' + url + '"]');
      if (existing) {
        if (existing.dataset.loaded === "true") {
          resolve();
          return;
        }
        existing.addEventListener("load", resolve);
        existing.addEventListener("error", function () {
          reject(new Error("Failed loading " + url));
        });
        return;
      }

      var script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.addEventListener("load", function () {
        script.dataset.loaded = "true";
        resolve();
      });
      script.addEventListener("error", function () {
        reject(new Error("Failed loading " + url));
      });
      document.head.appendChild(script);
    });
  }

  function ensureGsap(needScrollTrigger) {
    var gsapReady = window.gsap
      ? Promise.resolve()
      : loadScript(GSAP_URL).then(function () {
          if (!window.gsap) {
            throw new Error("GSAP unavailable.");
          }
        });

    return gsapReady.then(function () {
      if (!needScrollTrigger) {
        return;
      }

      if (window.ScrollTrigger) {
        return;
      }

      return loadScript(SCROLL_TRIGGER_URL).then(function () {
        if (!window.ScrollTrigger) {
          throw new Error("ScrollTrigger unavailable.");
        }
      });
    });
  }

  function parseTokens(raw) {
    var tokens = {};

    if (!raw) {
      return tokens;
    }

    raw.split(/\s+/).forEach(function (token) {
      var match;

      if (!token) {
        return;
      }

      tokens[token] = true;

      match = token.match(/^([a-z-]+)-(.+)$/);
      if (match) {
        tokens[match[1]] = match[2];
      }
    });

    return tokens;
  }

  function readAttr(el, attrs) {
    var names = Array.isArray(attrs) ? attrs : [attrs];
    var raw;
    var i;

    for (i = 0; i < names.length; i += 1) {
      raw = el.getAttribute(names[i]);
      if (raw !== null && raw !== "") {
        return raw;
      }
    }

    return null;
  }

  function readNumber(el, attrs, fallback) {
    var raw = readAttr(el, attrs);
    var value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  function readString(el, attrs, fallback) {
    var raw = readAttr(el, attrs);
    return raw === null || raw === "" ? fallback : raw;
  }

  function matchesAttrList(name, attrs) {
    var i;

    for (i = 0; i < attrs.length; i += 1) {
      if (attrs[i] === name) {
        return true;
      }
    }

    return false;
  }

  function isElement(node) {
    return Boolean(node && node.nodeType === 1);
  }

  function isPathNode(node) {
    return (
      isElement(node) &&
      (node.hasAttribute(PATH_ATTR) || node.hasAttribute(PATH_ATTR_ALT))
    );
  }

  function isRevealNode(node) {
    return isElement(node) && node.hasAttribute(REVEAL_ATTR);
  }

  function collectMatchingNodes(root, selector, collector) {
    if (!root) {
      return;
    }

    if (root.nodeType === 1 && root.matches(selector)) {
      collector.add(root);
    }

    if (
      (root.nodeType === 1 || root.nodeType === 9 || root.nodeType === 11) &&
      typeof root.querySelectorAll === "function"
    ) {
      Array.prototype.forEach.call(root.querySelectorAll(selector), function (el) {
        collector.add(el);
      });
    }
  }

  function resolveTarget(el, selector, fallback) {
    if (!selector || selector === "self") {
      return fallback || el;
    }

    if (selector === "parent") {
      return el.parentElement || fallback || el;
    }

    return document.querySelector(selector) || fallback || el;
  }

  function getDefaultTrigger() {
    return (
      document.querySelector(".msc-page") ||
      document.scrollingElement ||
      document.documentElement ||
      document.body
    );
  }

  function normalizePathMode(rawMode) {
    var mode = (rawMode || "").toLowerCase();

    if (mode === "autoplay") {
      return "autoplay";
    }

    return "scroll";
  }

  function normalizePathRepeat(rawRepeat) {
    var repeat = (rawRepeat || "").toLowerCase();

    if (repeat === "infinite" || repeat === "loop") {
      return -1;
    }

    return 0;
  }

  function getBasePathOptions(path) {
    var tokens = parseTokens(readAttr(path, [PATH_ATTR, PATH_ATTR_ALT]));

    return {
      drawFrom: readNumber(
        path,
        ["dv-path-from", "dv_path_from"],
        tokens.reverse ? 0 : 1
      ),
      drawTo: readNumber(
        path,
        ["dv-path-to", "dv_path_to"],
        tokens.reverse ? 1 : 0
      ),
      mode: normalizePathMode(
        readAttr(path, ["dv-path-mode", "dv_path_mode"]) || tokens.mode
      ),
      duration: readNumber(path, ["dv-path-duration", "dv_path_duration"], 2),
      repeat: normalizePathRepeat(
        readAttr(path, ["dv-path-repeat", "dv_path_repeat"]) || tokens.repeat
      ),
      rotateGradient:
        readAttr(path, ["dv-path-gradient", "dv_path_gradient"]) ||
        tokens.gradient ||
        "",
      rotateDuration: readNumber(
        path,
        ["dv-path-gradient-duration", "dv_path_gradient_duration"],
        5
      ),
      rotateCenter: readString(
        path,
        ["dv-path-gradient-center", "dv_path_gradient_center"],
        ""
      ),
      debug: readAttr(path, ["dv-path-debug", "dv_path_debug"]) !== null,
      pathData: path.getAttribute("d") || ""
    };
  }

  function getPathOptions(path) {
    var options = getBasePathOptions(path);
    var tokens;
    var triggerSelector;
    var hasCustomTrigger;

    if (options.mode === "autoplay") {
      options.trigger = null;
      options.triggerSelector = "";
      options.start = null;
      options.end = null;
      options.scrub = null;
      return options;
    }

    tokens = parseTokens(readAttr(path, [PATH_ATTR, PATH_ATTR_ALT]));
    triggerSelector =
      readAttr(path, ["dv-path-trigger", "dv_path_trigger"]) || tokens.trigger;
    hasCustomTrigger = Boolean(triggerSelector);

    options.triggerSelector = triggerSelector || "";
    options.trigger = hasCustomTrigger
      ? resolveTarget(path, triggerSelector, getDefaultTrigger())
      : null;
    options.scrub = readNumber(path, ["dv-path-scrub", "dv_path_scrub"], 1);
    options.start = readString(
      path,
      ["dv-path-start", "dv_path_start"],
      hasCustomTrigger ? "top top" : 0
    );
    options.end = readString(
      path,
      ["dv-path-end", "dv_path_end"],
      hasCustomTrigger ? "bottom bottom" : "max"
    );

    return options;
  }

  function setPathProgress(path, length, progress) {
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length * progress;
  }

  function getPathConfigKey(options) {
    return JSON.stringify({
      drawFrom: options.drawFrom,
      drawTo: options.drawTo,
      mode: options.mode,
      duration: options.duration,
      repeat: options.repeat,
      triggerSelector: options.triggerSelector || "",
      scrub: options.scrub,
      start: options.start,
      end: options.end,
      rotateGradient: options.rotateGradient,
      rotateDuration: options.rotateDuration,
      rotateCenter: options.rotateCenter,
      pathData: options.pathData
    });
  }

  function getAttachedScrollTriggers(path) {
    var matches = [];

    if (
      !window.ScrollTrigger ||
      typeof window.ScrollTrigger.getAll !== "function"
    ) {
      return matches;
    }

    window.ScrollTrigger.getAll().forEach(function (trigger) {
      var targets =
        trigger.animation && typeof trigger.animation.targets === "function"
          ? trigger.animation.targets()
          : [];

      if (targets.indexOf(path) !== -1) {
        matches.push(trigger);
      }
    });

    return matches;
  }

  function clearPathMarkers(path) {
    path.removeAttribute("data-dv-path-runtime");
    path.removeAttribute("data-dv-path-mode-resolved");
    path.removeAttribute("data-dv-path-init-count");
    path.removeAttribute("data-dv-path-controller");
  }

  function setPathMarkers(path, controller) {
    path.setAttribute("data-dv-path-runtime", RUNTIME_VERSION);
    path.setAttribute("data-dv-path-mode-resolved", controller.mode);
    path.setAttribute("data-dv-path-init-count", String(controller.initCount));
    path.setAttribute("data-dv-path-controller", controller.mode);
  }

  function destroyPathController(path) {
    var controller = PATH_CONTROLLERS.get(path);

    if (!controller) {
      return;
    }

    if (controller.scrollTrigger) {
      controller.scrollTrigger.kill();
    }

    if (controller.tween) {
      controller.tween.kill();
    }

    if (controller.gradientTween) {
      controller.gradientTween.kill();
    }

    if (window.gsap && typeof window.gsap.killTweensOf === "function") {
      window.gsap.killTweensOf(path);
    }

    getAttachedScrollTriggers(path).forEach(function (trigger) {
      trigger.kill();
    });

    PATH_CONTROLLERS.delete(path);
    ACTIVE_PATHS.delete(path);
    clearPathMarkers(path);
  }

  function cleanupOrphanedPathControllers(currentPaths) {
    ACTIVE_PATHS.forEach(function (path) {
      if (!path.isConnected || !currentPaths.has(path)) {
        destroyPathController(path);
      }
    });
  }

  function buildGradientTween(options) {
    var gradient;
    var rotateCenter;

    if (!options.rotateGradient) {
      return null;
    }

    gradient = document.querySelector(options.rotateGradient);
    rotateCenter = options.rotateCenter ? " " + options.rotateCenter : "";

    if (!gradient) {
      return null;
    }

    return window.gsap.to(gradient, {
      attr: { gradientTransform: "rotate(360" + rotateCenter + ")" },
      duration: options.rotateDuration,
      ease: "none",
      repeat: -1
    });
  }

  function initPathController(record, totalPathCount) {
    var path = record.path;
    var options = record.options;
    var controller = PATH_CONTROLLERS.get(path);
    var hadController = Boolean(controller);
    var initCount = controller ? controller.initCount + 1 : 1;
    var length;
    var nextController;
    var attachedTriggers;

    if (controller && controller.configKey === record.configKey) {
      setPathMarkers(path, controller);
      return false;
    }

    if (controller) {
      destroyPathController(path);
    }

    if (!path.getTotalLength) {
      return false;
    }

    length = path.getTotalLength();
    setPathProgress(path, length, options.drawFrom);

    nextController = {
      mode: options.mode,
      configKey: record.configKey,
      tween: null,
      scrollTrigger: null,
      gradientTween: null,
      runtimeVersion: RUNTIME_VERSION,
      runtimeInstanceId: RUNTIME_INSTANCE_ID,
      initCount: initCount
    };

    if (options.mode === "autoplay") {
      nextController.tween = window.gsap.to(path, {
        strokeDashoffset: length * options.drawTo,
        duration: options.duration,
        ease: "none",
        repeat: options.repeat,
        overwrite: "auto"
      });
    } else {
      nextController.tween = window.gsap.to(path, {
        strokeDashoffset: length * options.drawTo,
        ease: "none",
        overwrite: "auto",
        scrollTrigger: {
          trigger: options.trigger || undefined,
          start: options.start,
          end: options.end,
          scrub: options.scrub,
          invalidateOnRefresh: true
        }
      });
      nextController.scrollTrigger = nextController.tween.scrollTrigger || null;
    }

    nextController.gradientTween = buildGradientTween(options);

    PATH_CONTROLLERS.set(path, nextController);
    ACTIVE_PATHS.add(path);
    setPathMarkers(path, nextController);

    attachedTriggers = getAttachedScrollTriggers(path);

    if (options.mode === "autoplay" && attachedTriggers.length) {
      console.warn("[dv-path] Autoplay path has unexpected ScrollTrigger.", {
        path: path,
        mode: options.mode,
        triggerCount: attachedTriggers.length,
        runtime: RUNTIME_VERSION
      });
      attachedTriggers.forEach(function (trigger) {
        trigger.kill();
      });
      nextController.scrollTrigger = null;
    }

    if (options.debug) {
      console.info("[dv-path] Initialized", {
        path: path,
        runtime: RUNTIME_VERSION,
        runtimeInstance: RUNTIME_INSTANCE_ID,
        length: length,
        mode: options.mode,
        trigger: options.mode === "scroll" ? options.trigger || "document" : null,
        start: options.start,
        end: options.end,
        scrub: options.scrub,
        duration: options.duration,
        repeat: options.repeat,
        scrollTriggerAttached: Boolean(nextController.scrollTrigger),
        replacedController: hadController,
        totalPaths: totalPathCount
      });
    }

    return true;
  }

  function getRevealOptions(el) {
    var tokens = parseTokens(el.getAttribute(REVEAL_ATTR));

    return {
      y: readNumber(el, "dv-reveal-y", tokens.y ? Number(tokens.y) : 40),
      duration: readNumber(el, "dv-reveal-duration", 0.9),
      delay: readNumber(el, "dv-reveal-delay", 0),
      start: readString(el, "dv-reveal-start", "top 88%"),
      once: el.getAttribute("dv-reveal-once") !== "false",
      stagger: readNumber(el, "dv-reveal-stagger", 0)
    };
  }

  function initReveal(el) {
    var options;
    var targets;

    if (el.dataset[REVEAL_READY_FLAG] === "true") {
      return false;
    }

    options = getRevealOptions(el);
    targets = el.children.length && options.stagger > 0 ? el.children : el;

    window.gsap.from(targets, {
      y: options.y,
      opacity: 0,
      duration: options.duration,
      delay: options.delay,
      stagger: options.stagger,
      ease: "power3.out",
      scrollTrigger: {
        trigger: el,
        start: options.start,
        once: options.once
      }
    });

    el.dataset[REVEAL_READY_FLAG] = "true";
    return true;
  }

  function showReducedMotionFallback(paths, reveals) {
    ACTIVE_PATHS.forEach(function (path) {
      destroyPathController(path);
    });

    paths.forEach(function (path) {
      if (!path.getTotalLength) {
        return;
      }
      setPathProgress(path, path.getTotalLength(), 0);
    });

    reveals.forEach(function (el) {
      el.style.opacity = "1";
      el.style.transform = "none";
    });
  }

  function buildPathRecords(paths) {
    return paths
      .filter(function (path) {
        return Boolean(path.getTotalLength);
      })
      .map(function (path) {
        var options = getPathOptions(path);

        return {
          path: path,
          options: options,
          configKey: getPathConfigKey(options),
          duplicateKey: options.mode + "::" + (options.pathData || "")
        };
      });
  }

  function warnOnDuplicatePaths(records) {
    var counts = {};

    records.forEach(function (record) {
      if (!record.options.pathData) {
        return;
      }

      counts[record.duplicateKey] = (counts[record.duplicateKey] || 0) + 1;
    });

    Object.keys(counts).forEach(function (key) {
      if (counts[key] < 2 || DUPLICATE_WARNINGS[key]) {
        return;
      }

      DUPLICATE_WARNINGS[key] = true;
      console.warn("[dv-path] Duplicate path signature detected.", {
        mode: key.split("::")[0],
        count: counts[key],
        runtime: RUNTIME_VERSION
      });
    });
  }

  function scanDom() {
    var pathSet = new Set();
    var revealSet = new Set();
    var pathRecords;
    var scrollRecords;
    var autoplayRecords;

    collectMatchingNodes(
      document,
      "[" + PATH_ATTR + "],[" + PATH_ATTR_ALT + "]",
      pathSet
    );
    collectMatchingNodes(document, "[" + REVEAL_ATTR + "]", revealSet);

    pathRecords = buildPathRecords(Array.prototype.slice.call(pathSet));
    scrollRecords = pathRecords.filter(function (record) {
      return record.options.mode === "scroll";
    });
    autoplayRecords = pathRecords.filter(function (record) {
      return record.options.mode === "autoplay";
    });

    return {
      paths: Array.prototype.slice.call(pathSet),
      pathSet: pathSet,
      reveals: Array.prototype.slice.call(revealSet),
      pathRecords: pathRecords,
      scrollRecords: scrollRecords,
      autoplayRecords: autoplayRecords,
      needsScrollTrigger: scrollRecords.length > 0 || revealSet.size > 0
    };
  }

  function resolveTargetRecords(snapshot, targetPaths) {
    if (!targetPaths) {
      return snapshot.pathRecords;
    }

    return snapshot.pathRecords.filter(function (record) {
      return targetPaths.has(record.path);
    });
  }

  function initRuntime(targetPaths, forceScrollRefresh) {
    var snapshot = scanDom();
    var prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    var targetRecords = resolveTargetRecords(snapshot, targetPaths);

    cleanupOrphanedPathControllers(snapshot.pathSet);

    if (!snapshot.pathRecords.length && !snapshot.reveals.length) {
      return;
    }

    warnOnDuplicatePaths(snapshot.pathRecords);

    if (prefersReducedMotion) {
      showReducedMotionFallback(snapshot.paths, snapshot.reveals);
      return;
    }

    ensureGsap(snapshot.needsScrollTrigger)
      .then(function () {
        var didInitScrollFeatures = false;

        if (snapshot.needsScrollTrigger && window.ScrollTrigger) {
          window.gsap.registerPlugin(window.ScrollTrigger);
        }

        targetRecords
          .filter(function (record) {
            return record.options.mode === "autoplay";
          })
          .forEach(function (record) {
            initPathController(record, snapshot.pathRecords.length);
          });

        if (snapshot.needsScrollTrigger) {
          targetRecords
            .filter(function (record) {
              return record.options.mode === "scroll";
            })
            .forEach(function (record) {
              didInitScrollFeatures =
                initPathController(record, snapshot.pathRecords.length) ||
                didInitScrollFeatures;
            });

          snapshot.reveals.forEach(function (el) {
            didInitScrollFeatures = initReveal(el) || didInitScrollFeatures;
          });

          if (
            window.ScrollTrigger &&
            (didInitScrollFeatures || forceScrollRefresh === true)
          ) {
            window.ScrollTrigger.refresh();
          }
        }
      })
      .catch(function (error) {
        console.error("[dv-path] Initialization failed:", error);
      });
  }

  window.dvPathRefresh = function () {
    initRuntime(null, true);
  };

  function collectMutationPaths(records) {
    var affectedPaths = new Set();
    var i;

    for (i = 0; i < records.length; i += 1) {
      if (records[i].type === "attributes") {
        collectMatchingNodes(records[i].target, "[" + PATH_ATTR + "],[" + PATH_ATTR_ALT + "]", affectedPaths);
        continue;
      }

      Array.prototype.forEach.call(records[i].addedNodes, function (node) {
        collectMatchingNodes(
          node,
          "[" + PATH_ATTR + "],[" + PATH_ATTR_ALT + "]",
          affectedPaths
        );
      });
    }

    return affectedPaths;
  }

  function hasRelevantMutations(records) {
    var i;
    var record;

    for (i = 0; i < records.length; i += 1) {
      record = records[i];

      if (record.type === "childList") {
        return true;
      }

      if (
        record.type === "attributes" &&
        matchesAttrList(record.attributeName, PATH_CONTROLLER_ATTRS.concat(REVEAL_ATTRS))
      ) {
        return true;
      }
    }

    return false;
  }

  function watchForLatePaths() {
    var pendingRecords = [];
    var schedule;
    var observer;

    if (
      document.documentElement.dataset[OBSERVER_READY_FLAG] === "true" ||
      !("MutationObserver" in window)
    ) {
      return;
    }

    document.documentElement.dataset[OBSERVER_READY_FLAG] = "true";

    observer = new MutationObserver(function (records) {
      if (!hasRelevantMutations(records)) {
        return;
      }

      pendingRecords = pendingRecords.concat(records);
      window.clearTimeout(schedule);
      schedule = window.setTimeout(function () {
        var targetPaths = collectMutationPaths(pendingRecords);

        pendingRecords = [];
        initRuntime(targetPaths, false);
      }, 80);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: PATH_CONTROLLER_ATTRS.concat(REVEAL_ATTRS)
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initRuntime(null, false);
      watchForLatePaths();
    });
  } else {
    initRuntime(null, false);
    watchForLatePaths();
  }
})();
