const CATALOG = {
    products: [
        "CicloBeef Signature Frame",
        "CicloBeef Signature Acrylic",
    ],
    orientations: [
        "Vertical",
        "Horizontal",
    ],
    sizes: [
        "50 × 70 cm / 20 × 28\"",
        "60 × 90 cm / 24 × 36\"",
        "70 × 100 cm / 28 × 40\"",
    ],
};

const scrollBtn = document.getElementById("scrollBtn");
const navToggle = document.getElementById("navToggle");
const navLinks = document.getElementById("navLinks");
const focusableSelector = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

let lastNavFocus = null;

function scrollToSection(target) {
    if (!target) {
        return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "start" });
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

function renderCatalogList(selector, items) {
    const container = document.querySelector(selector);
    if (!container) {
        return;
    }

    container.innerHTML = items.map((item, index) => `
        <button type="button" class="catalog-option${index === 0 ? " is-selected" : ""}" aria-pressed="${index === 0 ? "true" : "false"}">
            ${item}
        </button>
    `).join("");

    container.querySelectorAll(".catalog-option").forEach(option => {
        option.addEventListener("click", () => {
            container.querySelectorAll(".catalog-option").forEach(item => {
                item.classList.remove("is-selected");
                item.setAttribute("aria-pressed", "false");
            });
            option.classList.add("is-selected");
            option.setAttribute("aria-pressed", "true");
        });
    });
}

function renderFormats() {
    const grid = document.querySelector("[data-format-grid]");
    const summaryGrid = document.querySelector("[data-format-summary-grid]");

    const cards = [];
    CATALOG.products.forEach(product => {
        CATALOG.orientations.forEach(orientation => {
            CATALOG.sizes.forEach(size => {
                cards.push(`
                    <article class="format-card" tabindex="0" aria-label="${product}, ${orientation}, ${size}">
                        <h3>${product}</h3>
                        <p>${orientation}</p>
                        <span>${size}</span>
                    </article>
                `);
            });
        });
    });

    if (grid) {
        grid.innerHTML = cards.join("");
    }

    if (summaryGrid) {
        summaryGrid.innerHTML = CATALOG.sizes.map(size => `
            <article class="format-card" tabindex="0" aria-label="Official size ${size}">
                <h3>Official Size</h3>
                <p>${size}</p>
                <span>Available for official studio editions and orientations by quote.</span>
            </article>
        `).join("");
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

function initProductBrowsers() {
    document.querySelectorAll("[data-product-browser]").forEach(browser => {
        const mainImage = browser.querySelector("[data-product-main-image]");
        const mainLabel = browser.querySelector("[data-product-main-label]");
        const options = Array.from(browser.querySelectorAll("[data-product-option]"));
        let switchTimer = null;

        if (!mainImage || !mainLabel || !options.length) {
            return;
        }

        function selectOption(option, { focus = false } = {}) {
            const nextImage = option.dataset.image;
            const nextAlt = option.dataset.alt || "";
            const nextLabel = option.dataset.label || "";

            if (!nextImage) {
                return;
            }

            options.forEach(item => {
                const isSelected = item === option;
                item.classList.toggle("is-selected", isSelected);
                item.setAttribute("aria-pressed", isSelected ? "true" : "false");
            });

            if (switchTimer) {
                window.clearTimeout(switchTimer);
            }

            browser.classList.add("is-switching");
            switchTimer = window.setTimeout(() => {
                mainImage.src = nextImage;
                mainImage.alt = nextAlt;
                mainLabel.textContent = nextLabel;
                browser.classList.remove("is-switching");
                switchTimer = null;
            }, reducedMotionQuery.matches ? 0 : 120);

            if (focus) {
                option.focus();
            }
        }

        options.forEach((option, index) => {
            option.addEventListener("click", () => selectOption(option));
            option.addEventListener("keydown", event => {
                const isForward = event.key === "ArrowRight" || event.key === "ArrowDown";
                const isBackward = event.key === "ArrowLeft" || event.key === "ArrowUp";

                if (!isForward && !isBackward) {
                    return;
                }

                event.preventDefault();
                const nextIndex = isForward
                    ? (index + 1) % options.length
                    : (index - 1 + options.length) % options.length;
                selectOption(options[nextIndex], { focus: true });
            });
        });
    });
}

function initSectionNavigation() {
    const sectionNav = document.querySelector(".section-nav");

    if (!sectionNav) {
        return;
    }

    const links = Array.from(sectionNav.querySelectorAll(".section-nav__link"));
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
        const isVisible = activeHash !== "#hero";

        sectionNav.classList.toggle("is-visible", isVisible);
        sectionNav.toggleAttribute("inert", !isVisible);

        destinations.forEach(({ hash, link }) => {
            if (hash === activeHash) {
                link.setAttribute("aria-current", "location");
            } else {
                link.removeAttribute("aria-current");
            }
        });
    }

    function updateActiveDestination() {
        const activationLine = window.scrollY + (window.innerHeight * 0.08);
        let activeDestination = destinations[0];

        destinations.forEach(destination => {
            const targetTop = destination.target.getBoundingClientRect().top + window.scrollY;

            if (targetTop <= activationLine && targetTop >= (activeDestination.target.getBoundingClientRect().top + window.scrollY)) {
                activeDestination = destination;
            }
        });

        setActiveDestination(activeDestination.hash);
    }

    links.forEach(link => {
        link.addEventListener("click", () => {
            const hash = link.getAttribute("href");

            if (hash) {
                setActiveDestination(hash);
            }
        });
    });

    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(updateActiveDestination, {
            rootMargin: "-8% 0px -91% 0px",
            threshold: [0, 0.01],
        });

        destinations.forEach(({ target }) => observer.observe(target));
    }

    window.addEventListener("hashchange", () => window.requestAnimationFrame(updateActiveDestination));
    updateActiveDestination();
}

if (scrollBtn) {
    scrollBtn.addEventListener("click", () => {
        scrollToSection(document.getElementById("gallery"));
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
        scrollToSection(target);
        closeMobileNav({ restoreFocus: false });
    });
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeMobileNav();
    }
});

renderCatalogList("[data-catalog-products]", CATALOG.products);
renderCatalogList("[data-catalog-orientations]", CATALOG.orientations);
renderCatalogList("[data-catalog-sizes]", CATALOG.sizes);
renderFormats();
initGallery();
initHeroArtworkReflection();
initCol001ScrollReveal();
initProductBrowsers();
initSectionNavigation();
