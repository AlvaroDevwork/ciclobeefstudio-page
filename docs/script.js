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

function initSeasonalHero() {
    const tree = document.querySelector("[data-hero-tree]");

    if (!tree) {
        return;
    }

    if (reducedMotionQuery.matches) {
        tree.classList.add("is-illuminated");
        return;
    }

    window.setTimeout(() => {
        tree.classList.add("is-illuminated");
    }, 1500);
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

function initAboutFaq() {
    const items = Array.from(document.querySelectorAll("#about .cbs-about__faq-list details"));
    const precisePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const mobileViewport = window.matchMedia("(max-width: 600px)");

    if (!items.length) {
        return;
    }

    function activateItem(activeItem) {
        items.forEach(item => {
            item.open = item === activeItem;
        });
    }

    function syncFaqViewport() {
        if (mobileViewport.matches) {
            items.forEach(item => {
                item.open = false;
            });
        } else if (!items.some(item => item.open)) {
            activateItem(items[0]);
        }
    }

    items.forEach(item => {
        const summary = item.querySelector("summary");

        item.addEventListener("pointerenter", event => {
            if (precisePointer.matches && event.pointerType !== "touch") {
                activateItem(item);
            }
        });

        summary?.addEventListener("focus", () => {
            if (!mobileViewport.matches) {
                activateItem(item);
            }
        });
    });

    mobileViewport.addEventListener("change", syncFaqViewport);
    syncFaqViewport();
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

initSeasonalHero();
initHeaderGeometry();
initHeaderNavigationState();
initAboutFaq();
