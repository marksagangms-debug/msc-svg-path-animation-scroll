(function () {
  "use strict";

  var PATH_ATTR = "dv-path";
  var PATH_ATTR_ALT = "dv_path";
  var REVEAL_ATTR = "dv-reveal";
  var READY_FLAG = "dvPathReady";
  var REVEAL_READY_FLAG = "dvRevealReady";
  var OBSERVER_READY_FLAG = "dvPathObserverReady";
  var REFRESH_READY_FLAG = "dvPathRefreshReady";
  var MOBILE_QUERY = "(max-width: 767px), (pointer: coarse)";
  var GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";
  var SCROLL_TRIGGER_URL =
    "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/ScrollTrigger.min.js";
  var refreshSchedule;
  var scrollTriggerConfigured = false;
  var lastViewportWidth;
  var lastViewportHeight;
  var mobilePathDrivers = [];

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

  function ensureGsapCore() {
    var gsapReady = window.gsap
      ? Promise.resolve()
      : loadScript(GSAP_URL).then(function () {
          if (!window.gsap) {
            throw new Error("GSAP unavailable.");
          }
        });

    return gsapReady;
  }

  function ensureGsap() {
    return ensureGsapCore().then(function () {
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

    for (var i = 0; i < names.length; i += 1) {
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

  function readBoolean(el, attrs, fallback) {
    var raw = readAttr(el, attrs);

    if (raw === null) {
      return fallback;
    }

    return raw !== "false";
  }

  function isMobileTouch() {
    return window.matchMedia && window.matchMedia(MOBILE_QUERY).matches;
  }

  function getViewportSize() {
    var viewport = window.visualViewport;

    return {
      width: Math.round(
        (viewport && viewport.width) ||
          window.innerWidth ||
          document.documentElement.clientWidth ||
          0
      ),
      height: Math.round(
        (viewport && viewport.height) ||
          window.innerHeight ||
          document.documentElement.clientHeight ||
          0
      )
    };
  }

  function rememberViewportSize() {
    var size = getViewportSize();

    lastViewportWidth = size.width;
    lastViewportHeight = size.height;

    return size;
  }

  function shouldRefreshForResize() {
    var previousWidth = lastViewportWidth;
    var previousHeight = lastViewportHeight;
    var size = rememberViewportSize();
    var widthChanged = size.width !== previousWidth;
    var heightChanged = size.height !== previousHeight;

    if (!isMobileTouch()) {
      return true;
    }

    if (typeof previousWidth !== "number") {
      return true;
    }

    // iOS browser chrome changes viewport height during scroll; refreshing there
    // interrupts native momentum, so only real width changes should refresh.
    return widthChanged || !heightChanged;
  }

  function configureScrollTrigger() {
    if (scrollTriggerConfigured || !window.ScrollTrigger) {
      return;
    }

    if (window.ScrollTrigger.config) {
      window.ScrollTrigger.config({
        ignoreMobileResize: true
      });
    }

    scrollTriggerConfigured = true;
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

  function getPathOptions(path) {
    var tokens = parseTokens(readAttr(path, [PATH_ATTR, PATH_ATTR_ALT]));
    var mobile = isMobileTouch();
    var triggerSelector =
      readAttr(path, ["dv-path-trigger", "dv_path_trigger"]) ||
      tokens.trigger;
    var hasCustomTrigger = Boolean(triggerSelector);
    var trigger = hasCustomTrigger
      ? resolveTarget(path, triggerSelector, getDefaultTrigger())
      : null;

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
      scrub: readNumber(path, ["dv-path-scrub", "dv_path_scrub"], 1),
      start: readString(
        path,
        ["dv-path-start", "dv_path_start"],
        hasCustomTrigger ? "top top" : 0
      ),
      end: readString(
        path,
        ["dv-path-end", "dv_path_end"],
        hasCustomTrigger ? "bottom bottom" : "max"
      ),
      trigger: trigger,
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
      mobile: mobile,
      mobileMode: readString(path, ["dv-path-mobile", "dv_path_mobile"], ""),
      mobileGradient: readBoolean(
        path,
        ["dv-path-mobile-gradient", "dv_path_mobile_gradient"],
        false
      ),
      debug: readAttr(path, ["dv-path-debug", "dv_path_debug"]) !== null
    };
  }

  function setPathProgress(path, length, progress) {
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length * progress;
  }

  function getPathScrub(options) {
    return options.mobile ? true : options.scrub;
  }

  function shouldRotateGradient(options) {
    if (!options.rotateGradient) {
      return false;
    }

    return !options.mobile || options.mobileGradient;
  }

  function initGradient(options) {
    var gradient;
    var rotateCenter;

    if (!shouldRotateGradient(options) || !window.gsap) {
      return;
    }

    gradient = document.querySelector(options.rotateGradient);
    rotateCenter = options.rotateCenter ? " " + options.rotateCenter : "";

    if (gradient) {
      window.gsap.to(gradient, {
        attr: { gradientTransform: "rotate(360" + rotateCenter + ")" },
        duration: options.rotateDuration,
        ease: "none",
        repeat: -1
      });
    }
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getScrollTop() {
    return (
      window.pageYOffset ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0
    );
  }

  function getMaxScroll() {
    var doc = document.documentElement;
    var body = document.body;
    var scrollHeight = Math.max(
      doc.scrollHeight,
      body ? body.scrollHeight : 0,
      doc.offsetHeight,
      body ? body.offsetHeight : 0
    );

    return Math.max(0, scrollHeight - getViewportSize().height);
  }

  function getElementTop(el) {
    return el.getBoundingClientRect().top + getScrollTop();
  }

  function parseAnchor(raw, size) {
    var value = String(raw || "top").trim();
    var number;

    if (value === "top" || value === "left") {
      return 0;
    }

    if (value === "center") {
      return size / 2;
    }

    if (value === "bottom" || value === "right") {
      return size;
    }

    if (value.indexOf("%") > -1) {
      number = parseFloat(value);
      return Number.isFinite(number) ? (number / 100) * size : 0;
    }

    number = parseFloat(value);
    return Number.isFinite(number) ? number : 0;
  }

  function resolveScrollPoint(raw, trigger, fallback) {
    var value = raw;
    var viewportHeight = getViewportSize().height;
    var rect;
    var parts;

    if (typeof value === "number") {
      return value;
    }

    if (value === "max") {
      return getMaxScroll();
    }

    if (!trigger || typeof value !== "string") {
      return fallback;
    }

    parts = value.trim().split(/\s+/);
    if (!parts.length) {
      return fallback;
    }

    rect = trigger.getBoundingClientRect();
    return (
      getElementTop(trigger) +
      parseAnchor(parts[0], rect.height) -
      parseAnchor(parts[1] || "top", viewportHeight)
    );
  }

  function initMobilePathDriver(path, length, options) {
    var mode = options.mobileMode || "lite";
    var start = 0;
    var end = 1;
    var ticking = false;
    var scrollTimer;
    var lastUpdate = 0;
    var passive = { passive: true };
    var driverViewport = getViewportSize();

    function shouldRefreshDriverForResize() {
      var previousWidth = driverViewport.width;
      var previousHeight = driverViewport.height;
      var widthChanged;
      var heightChanged;

      driverViewport = getViewportSize();
      widthChanged = driverViewport.width !== previousWidth;
      heightChanged = driverViewport.height !== previousHeight;

      if (!isMobileTouch()) {
        return true;
      }

      return widthChanged || !heightChanged;
    }

    function refresh() {
      var trigger = options.trigger || getDefaultTrigger();

      driverViewport = getViewportSize();
      start = resolveScrollPoint(options.start, trigger, 0);
      end = resolveScrollPoint(options.end, trigger, getMaxScroll());

      if (end === start) {
        end = start + 1;
      }

      update();
    }

    function update() {
      var progress = clamp((getScrollTop() - start) / (end - start), 0, 1);
      var drawProgress =
        options.drawFrom + (options.drawTo - options.drawFrom) * progress;

      ticking = false;
      lastUpdate = Date.now();
      setPathProgress(path, length, drawProgress);
    }

    function requestSmoothUpdate() {
      if (ticking) {
        return;
      }

      ticking = true;
      window.requestAnimationFrame(update);
    }

    function requestLiteUpdate() {
      var elapsed = Date.now() - lastUpdate;

      window.clearTimeout(scrollTimer);

      if (elapsed > 90) {
        requestSmoothUpdate();
        return;
      }

      scrollTimer = window.setTimeout(requestSmoothUpdate, 90 - elapsed);
    }

    function requestSettleUpdate() {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(requestSmoothUpdate, 140);
    }

    function requestUpdate() {
      if (mode === "smooth") {
        requestSmoothUpdate();
        return;
      }

      if (mode === "settle") {
        requestSettleUpdate();
        return;
      }

      requestLiteUpdate();
    }

    window.addEventListener("scroll", requestUpdate, passive);
    window.addEventListener("resize", function () {
      if (shouldRefreshDriverForResize()) {
        refresh();
      }
    });
    window.addEventListener("orientationchange", function () {
      window.setTimeout(refresh, 220);
    });
    window.addEventListener("load", function () {
      window.setTimeout(refresh, 120);
    });

    mobilePathDrivers.push({
      refresh: refresh
    });

    refresh();
  }

  function refreshMobilePathDrivers() {
    mobilePathDrivers.forEach(function (driver) {
      driver.refresh();
    });
  }

  function scheduleRefresh(delay) {
    if (!window.ScrollTrigger) {
      return;
    }

    window.clearTimeout(refreshSchedule);
    refreshSchedule = window.setTimeout(function () {
      window.ScrollTrigger.refresh();
    }, typeof delay === "number" ? delay : 80);
  }

  function initPath(path) {
    var length;
    var options;
    var scrub;

    if (path.dataset[READY_FLAG] === "true" || !path.getTotalLength) {
      return;
    }

    length = path.getTotalLength();
    options = getPathOptions(path);
    setPathProgress(path, length, options.drawFrom);
    scrub = getPathScrub(options);

    if (options.mobile && options.mobileMode === "static") {
      setPathProgress(path, length, options.drawTo);
      path.dataset[READY_FLAG] = "true";
      return;
    }

    if (options.mobile && options.mobileMode !== "gsap") {
      initMobilePathDriver(path, length, options);
      initGradient(options);
      path.dataset[READY_FLAG] = "true";
      return;
    }

    if (options.debug) {
      console.info("[dv-path] Initialized", {
        path: path,
        length: length,
        trigger: options.trigger || "document",
        start: options.start,
        end: options.end,
        scrub: scrub,
        mobile: options.mobile
      });
    }

    window.gsap.to(path, {
      strokeDashoffset: length * options.drawTo,
      ease: "none",
      scrollTrigger: {
        trigger: options.trigger || undefined,
        start: options.start,
        end: options.end,
        scrub: scrub,
        invalidateOnRefresh: true
      }
    });

    initGradient(options);

    path.dataset[READY_FLAG] = "true";
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

  function getRevealRootMargin(start) {
    var match = String(start || "").match(/top\s+(\d+(?:\.\d+)?)%/);
    var offset = match ? 100 - Number(match[1]) : 12;

    return "0px 0px -" + clamp(offset, 0, 100) + "% 0px";
  }

  function initNativeReveal(el) {
    var options;
    var targets;
    var targetList;
    var observer;

    if (el.dataset[REVEAL_READY_FLAG] === "true") {
      return;
    }

    options = getRevealOptions(el);
    targets = el.children.length && options.stagger > 0 ? el.children : [el];
    targetList = Array.prototype.slice.call(targets);

    targetList.forEach(function (target, index) {
      var delay = options.delay + index * options.stagger;

      target.style.opacity = "0";
      target.style.transform = "translate3d(0, " + options.y + "px, 0)";
      target.style.transition =
        "opacity " +
        options.duration +
        "s ease " +
        delay +
        "s, transform " +
        options.duration +
        "s ease " +
        delay +
        "s";
      target.style.willChange = "opacity, transform";
    });

    function show() {
      targetList.forEach(function (target) {
        target.style.opacity = "1";
        target.style.transform = "translate3d(0, 0, 0)";
      });
    }

    function hide() {
      targetList.forEach(function (target) {
        target.style.opacity = "0";
        target.style.transform = "translate3d(0, " + options.y + "px, 0)";
      });
    }

    if (!("IntersectionObserver" in window)) {
      show();
      el.dataset[REVEAL_READY_FLAG] = "true";
      return;
    }

    observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            show();
            if (options.once) {
              observer.unobserve(el);
            }
          } else if (!options.once) {
            hide();
          }
        });
      },
      {
        rootMargin: getRevealRootMargin(options.start),
        threshold: 0
      }
    );

    observer.observe(el);
    el.dataset[REVEAL_READY_FLAG] = "true";
  }

  function initReveal(el) {
    var options;
    var targets;

    if (isMobileTouch()) {
      initNativeReveal(el);
      return;
    }

    if (el.dataset[REVEAL_READY_FLAG] === "true") {
      return;
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
  }

  function showReducedMotionFallback(paths, reveals) {
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

  function getRuntimeNeeds(paths, reveals) {
    var mobile = isMobileTouch();
    var needsScrollTrigger = !mobile && reveals.length > 0;
    var needsGsap = needsScrollTrigger;

    paths.forEach(function (path) {
      var options = getPathOptions(path);

      if (shouldRotateGradient(options)) {
        needsGsap = true;
      }

      if (!options.mobile || options.mobileMode === "gsap") {
        needsGsap = true;
        needsScrollTrigger = true;
      }
    });

    return {
      gsap: needsGsap,
      scrollTrigger: needsScrollTrigger
    };
  }

  function initAll() {
    var paths = Array.prototype.slice.call(
      document.querySelectorAll("[" + PATH_ATTR + "],[" + PATH_ATTR_ALT + "]")
    );
    var reveals = Array.prototype.slice.call(
      document.querySelectorAll("[" + REVEAL_ATTR + "]")
    );
    var prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    var runtimeNeeds;
    var runtimeReady;

    if (!paths.length && !reveals.length) {
      return;
    }

    if (prefersReducedMotion) {
      showReducedMotionFallback(paths, reveals);
      return;
    }

    runtimeNeeds = getRuntimeNeeds(paths, reveals);

    if (!runtimeNeeds.gsap) {
      paths.forEach(initPath);
      reveals.forEach(initReveal);
      return;
    }

    runtimeReady = runtimeNeeds.scrollTrigger ? ensureGsap() : ensureGsapCore();

    runtimeReady
      .then(function () {
        if (runtimeNeeds.scrollTrigger) {
          window.gsap.registerPlugin(window.ScrollTrigger);
          configureScrollTrigger();
        }

        paths.forEach(initPath);
        reveals.forEach(initReveal);

        if (runtimeNeeds.scrollTrigger) {
          scheduleRefresh();
        }
      })
      .catch(function (error) {
        console.error("[dv-path] Initialization failed:", error);
      });
  }

  window.dvPathRefresh = function () {
    initAll();
    refreshMobilePathDrivers();
    scheduleRefresh(0);
  };

  function watchForRefreshEvents() {
    if (document.documentElement.dataset[REFRESH_READY_FLAG] === "true") {
      return;
    }

    document.documentElement.dataset[REFRESH_READY_FLAG] = "true";
    rememberViewportSize();

    window.addEventListener("load", function () {
      rememberViewportSize();
      scheduleRefresh(120);
    });
    window.addEventListener("resize", function () {
      if (shouldRefreshForResize()) {
        scheduleRefresh(160);
      }
    });
    window.addEventListener("orientationchange", function () {
      rememberViewportSize();
      scheduleRefresh(220);
    });
  }

  function watchForLatePaths() {
    if (
      document.documentElement.dataset[OBSERVER_READY_FLAG] === "true" ||
      !("MutationObserver" in window)
    ) {
      return;
    }

    document.documentElement.dataset[OBSERVER_READY_FLAG] = "true";

    var schedule;
    var observer = new MutationObserver(function () {
      window.clearTimeout(schedule);
      schedule = window.setTimeout(initAll, 80);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        PATH_ATTR,
        PATH_ATTR_ALT,
        "dv-path-scrub",
        "dv_path_scrub",
        "dv-path-trigger",
        "dv_path_trigger",
        "dv-path-mobile",
        "dv_path_mobile",
        "dv-path-mobile-gradient",
        "dv_path_mobile_gradient"
      ]
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initAll();
      watchForLatePaths();
      watchForRefreshEvents();
    });
  } else {
    initAll();
    watchForLatePaths();
    watchForRefreshEvents();
  }
})();
