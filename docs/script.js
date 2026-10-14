const scrollBtn = document.getElementById("scrollBtn");
const navToggle = document.getElementById("navToggle");
const navLinks = document.getElementById("navLinks");
const persistentHeader = document.querySelector(".landing-nav");
const focusableSelector = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

let lastNavFocus = null;
let lastHeaderOccupiedHeight = null;

function getAnchorVisualGap() {
    const value = window.getComputedStyle(document.documentElement)
        .getPropertyValue("--cbs-anchor-visual-gap");
    return Number.parseFloat(value) || 0;
}

function measureHeaderGeometry() {
    const occupiedHeight = persistentHeader
        ? Math.max(0, persistentHeader.getBoundingClientRect().bottom)
        : 0;
    const roundedHeight = Math.ceil(occupiedHeight);

    if (roundedHeight !== lastHeaderOccupiedHeight) {
        document.documentElement.style.setProperty("--cbs-header-occupied-height", `${roundedHeight}px`);
        lastHeaderOccupiedHeight = roundedHeight;
    }

    return {
        occupiedHeight,
        visualGap: getAnchorVisualGap(),
    };
}

function scrollToSection(target) {
    if (!target) {
        return;
    }

    measureHeaderGeometry();
    const computedScrollMargin = Number.parseFloat(
        window.getComputedStyle(target).scrollMarginTop,
    );
    const sectionOffset = Number.isFinite(computedScrollMargin)
        ? computedScrollMargin
        : 0;
    const targetTop = target.id === "hero"
        ? 0
        : target.getBoundingClientRect().top + window.scrollY - sectionOffset;

    window.scrollTo({
        top: Math.max(0, Math.round(targetTop)),
        behavior: reducedMotionQuery.matches ? "auto" : "smooth",
    });
}

function initHeaderGeometry() {
    measureHeaderGeometry();

    let resizeFrame = 0;
    const scheduleMeasurement = () => {
        if (resizeFrame) {
            return;
        }
        resizeFrame = window.requestAnimationFrame(() => {
            resizeFrame = 0;
            measureHeaderGeometry();
        });
    };

    window.addEventListener("resize", scheduleMeasurement, { passive: true });

    if (persistentHeader && "ResizeObserver" in window) {
        const headerObserver = new ResizeObserver(scheduleMeasurement);
        headerObserver.observe(persistentHeader);
    }

    window.addEventListener("load", () => {
        measureHeaderGeometry();
        const initialTargetId = window.location.hash.slice(1);
        const initialTarget = initialTargetId
            ? document.getElementById(initialTargetId)
            : null;
        if (initialTarget) {
            scrollToSection(initialTarget);
        }
    }, { once: true });
}

function getFocusableItems(container) {
    return Array.from(container.querySelectorAll(focusableSelector))
        .filter(item => item.offsetParent !== null);
}

function lockPageScroll(shouldLock) {
    document.body.classList.toggle("nav-open", shouldLock);
}

function openMobileNav() {
    if (!navToggle || !navLinks) {
        return;
    }

    lastNavFocus = document.activeElement;
    navLinks.classList.add("show");
    navToggle.classList.add("is-open");
    navToggle.setAttribute("aria-expanded", "true");
    navToggle.setAttribute("aria-label", "Close menu");
    lockPageScroll(true);

    const firstLink = navLinks.querySelector("a");
    if (firstLink) {
        firstLink.focus();
    }
}

function closeMobileNav({ restoreFocus = true } = {}) {
    if (!navToggle || !navLinks) {
        return;
    }

    navLinks.classList.remove("show");
    navToggle.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open menu");
    lockPageScroll(false);

    if (restoreFocus && lastNavFocus && typeof lastNavFocus.focus === "function") {
        lastNavFocus.focus();
    }
}

function toggleMobileNav() {
    if (!navLinks || !navToggle) {
        return;
    }

    if (navLinks.classList.contains("show")) {
        closeMobileNav();
        return;
    }

    openMobileNav();
}

function trapNavFocus(event) {
    if (event.key !== "Tab" || !navLinks || !navLinks.classList.contains("show")) {
        return;
    }

    const focusableItems = getFocusableItems(navLinks);
    if (!focusableItems.length) {
        return;
    }

    const firstItem = focusableItems[0];
    const lastItem = focusableItems[focusableItems.length - 1];

    if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
    } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
    }
}

function initGallery() {
    const slider = document.querySelector("[data-gallery-slider]");
    const track = document.querySelector("[data-gallery-track]");
    const prevButton = document.querySelector("[data-gallery-prev]");
    const nextButton = document.querySelector("[data-gallery-next]");

    if (!slider || !track || !prevButton || !nextButton) {
        return;
    }

    const slides = Array.from(track.children);
    let activeIndex = 0;

    function updateGallery(index) {
        if (!slides.length) {
            return;
        }

        activeIndex = (index + slides.length) % slides.length;
        track.scrollTo({
            left: slides[activeIndex].offsetLeft - track.offsetLeft,
            behavior: reducedMotionQuery.matches ? "auto" : "smooth",
        });
    }

    prevButton.addEventListener("click", () => updateGallery(activeIndex - 1));
    nextButton.addEventListener("click", () => updateGallery(activeIndex + 1));

    track.addEventListener("scroll", () => {
        if (!slides.length) {
            return;
        }

        const slideWidth = slides[0].getBoundingClientRect().width || 1;
        const nextIndex = Math.round(track.scrollLeft / slideWidth);
        if (nextIndex !== activeIndex && nextIndex >= 0 && nextIndex < slides.length) {
            activeIndex = nextIndex;
        }
    }, { passive: true });
}

function initHeroArtworkReflection() {
    const reflection = document.querySelector(".hero-artwork-reflection");
    const hero = document.getElementById("hero");

    if (!reflection || !hero || reducedMotionQuery.matches || !window.gsap) {
        return;
    }

    let reflectionTimer = null;
    let activeReflection = null;

    function playReflection() {
        if (activeReflection && activeReflection.isActive()) {
            return;
        }

        window.gsap.set(reflection, { autoAlpha: 0, "--hero-reflection-x": "-118%" });
        activeReflection = window.gsap.timeline({
            defaults: { ease: "sine.inOut" },
            onComplete: () => {
                activeReflection = null;
            },
        });

        activeReflection
            .to(reflection, { autoAlpha: 0.34, "--hero-reflection-x": "118%", duration: 2.75 })
            .to(reflection, { autoAlpha: 0, duration: 0.46, ease: "power1.out" });
    }

    function stopReflection() {
        if (reflectionTimer) {
            window.clearInterval(reflectionTimer);
            reflectionTimer = null;
        }

        if (activeReflection) {
            activeReflection.kill();
            activeReflection = null;
        }

        window.gsap.set(reflection, { autoAlpha: 0, "--hero-reflection-x": "-118%" });
    }

    if (!("IntersectionObserver" in window)) {
        playReflection();
        reflectionTimer = window.setInterval(playReflection, 8000);
        return;
    }

    const observer = new IntersectionObserver(entries => {
        const isHeroVisible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.45);

        if (!isHeroVisible) {
            stopReflection();
            return;
        }

        playReflection();

        if (!reflectionTimer) {
            reflectionTimer = window.setInterval(playReflection, 8000);
        }
    }, { threshold: [0, 0.45, 0.7] });

    observer.observe(hero);
}

function initCol001ScrollReveal() {
    if (!window.gsap || !window.ScrollTrigger || reducedMotionQuery.matches) {
        return;
    }

    window.gsap.registerPlugin(window.ScrollTrigger);
    window.gsap.fromTo("[data-gallery-item]", {
        autoAlpha: 0,
        y: 22,
    }, {
        autoAlpha: 1,
        y: 0,
        duration: 0.58,
        stagger: 0.07,
        ease: "power2.out",
        scrollTrigger: {
            trigger: "#gallery",
            start: "top 72%",
            once: true,
        },
    });
}

function initHeaderNavigationState() {
    const links = Array.from(document.querySelectorAll('.nav-links a[href^="#"]'));
    const destinations = links
        .map(link => {
            const hash = link.getAttribute("href");
            const target = hash ? document.querySelector(hash) : null;
            return target ? { hash, link, target } : null;
        })
        .filter(Boolean);

    if (!destinations.length) {
        return;
    }

    function setActiveDestination(activeHash) {
        destinations.forEach(({ hash, link }) => {
            if (hash === activeHash) {
                link.setAttribute("aria-current", "location");
            } else {
                link.removeAttribute("aria-current");
            }
        });
    }

    function updateActiveDestination() {
        const { occupiedHeight, visualGap } = measureHeaderGeometry();
        const activationLine = window.scrollY + occupiedHeight + visualGap + 1;
        let activeDestination = null;

        destinations.forEach(destination => {
            const targetTop = destination.target.getBoundingClientRect().top + window.scrollY;

            if (targetTop <= activationLine) {
                activeDestination = destination;
            }
        });

        setActiveDestination(activeDestination?.hash ?? "");
    }

    links.forEach(link => {
        link.addEventListener("click", () => {
            const hash = link.getAttribute("href");

            if (hash) {
                setActiveDestination(hash);
            }
        });
    });

    let updateFrame = 0;
    window.addEventListener("scroll", () => {
        if (updateFrame) {
            return;
        }
        updateFrame = window.requestAnimationFrame(() => {
            updateFrame = 0;
            updateActiveDestination();
        });
    }, { passive: true });
    window.addEventListener("hashchange", () => window.requestAnimationFrame(updateActiveDestination));
    updateActiveDestination();
}

if (scrollBtn) {
    scrollBtn.addEventListener("click", () => {
        scrollToSection(document.getElementById("products"));
    });
}

if (navToggle && navLinks) {
    navToggle.addEventListener("click", toggleMobileNav);
    navLinks.addEventListener("keydown", trapNavFocus);
}

document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener("click", event => {
        const targetSelector = link.getAttribute("href");
        if (!targetSelector || targetSelector === "#") {
            return;
        }

        const target = document.querySelector(targetSelector);

        if (!target) {
            return;
        }

        event.preventDefault();
        closeMobileNav({ restoreFocus: false });
        scrollToSection(target);
    });
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeMobileNav();
    }
});

initGallery();
initHeroArtworkReflection();
initCol001ScrollReveal();
initHeaderGeometry();
initHeaderNavigationState();
