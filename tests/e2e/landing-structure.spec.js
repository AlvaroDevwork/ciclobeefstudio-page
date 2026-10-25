const { expect, test } = require("@playwright/test");

const PRIMARY_SECTIONS = ["hero", "products", "about", "contact"];

test("landing architecture contains the four approved primary sections", async ({ page }) => {
    await page.goto("/?cbs-cart-qa=1", { waitUntil: "domcontentloaded" });
    const structure = await page.evaluate(() => ({
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        sections: Array.from(document.querySelectorAll("body > section, body > main > section"), section => section.id),
        galleryNodes: document.querySelectorAll("#gallery, [data-gallery-slider], [data-gallery-item]").length,
        galleryLinks: document.querySelectorAll('a[href="#gallery"]').length,
        formatsNodes: document.querySelectorAll("#formats, [aria-labelledby*=Formats], .format-system").length,
        formatsLinks: document.querySelectorAll('a[href="#formats"]').length,
        customRequestsNodes: document.querySelectorAll("#custom-requests").length,
        customRequestsLinks: document.querySelectorAll('a[href="#custom-requests"]').length,
        processNodes: document.querySelectorAll("#process").length,
        processLinks: document.querySelectorAll('a[href="#process"]').length,
        quoteIds: document.querySelectorAll("#quote, [id*=quote]").length,
        navigation: (() => {
            const nav = document.querySelector(".landing-nav");
            const logo = document.querySelector(".nav-logo");
            const toggle = document.querySelector(".nav-toggle");
            const links = document.querySelector(".nav-links");
            const navRect = nav.getBoundingClientRect();
            const logoRect = logo.getBoundingClientRect();
            const linksRect = links.getBoundingClientRect();
            return {
                toggleDisplay: getComputedStyle(toggle).display,
                linksDisplay: getComputedStyle(links).display,
                linksDirection: getComputedStyle(links).flexDirection,
                linkCount: links.querySelectorAll("a").length,
                linksInsideNav: linksRect.top >= navRect.top
                    && linksRect.bottom <= navRect.bottom
                    && linksRect.right <= navRect.right,
                logoSeparated: logoRect.right <= linksRect.left,
            };
        })(),
        productTitleWeights: Array.from(
            document.querySelectorAll("#products .cbs-product-card__body h4"),
            node => getComputedStyle(node).fontWeight,
        ),
        productPagerStatuses: Array.from(
            document.querySelectorAll("#products .cbs-store-pager__status"),
            node => {
                const style = getComputedStyle(node);
                return {
                    position: style.position,
                    width: node.getBoundingClientRect().width,
                    clipPath: style.clipPath,
                };
            },
        ),
        productPagerButtonCount: document.querySelectorAll("#products .cbs-store-pager__button").length,
        productActionGeometry: Array.from(
            document.querySelectorAll("#products .cbs-store-group:not([hidden]) .cbs-product-card"),
            card => {
                const action = card.querySelector(".cbs-composer-launcher");
                const title = card.querySelector(".cbs-product-card__body h4");
                const cardRect = card.getBoundingClientRect();
                const actionRect = action?.getBoundingClientRect();
                const actionStyle = action ? getComputedStyle(action) : null;
                const titleRange = document.createRange();
                titleRange.selectNodeContents(title);
                const titleTextRects = Array.from(titleRange.getClientRects())
                    .filter(rect => rect.width > 0 && rect.height > 0);
                const rectanglesOverlap = (first, second) => (
                    Math.max(first.left, second.left) < Math.min(first.right, second.right)
                    && Math.max(first.top, second.top) < Math.min(first.bottom, second.bottom)
                );
                const adjacentInteractiveRects = Array.from(
                    card.querySelectorAll("a, button, input, select, textarea, [tabindex]"),
                ).filter(node => (
                    node !== action
                    && !action?.contains(node)
                    && node.getClientRects().length
                    && getComputedStyle(node).display !== "none"
                    && getComputedStyle(node).visibility !== "hidden"
                )).map(node => node.getBoundingClientRect());
                return {
                    hasAction: Boolean(actionRect),
                    visible: Boolean(
                        actionRect
                        && actionRect.width > 0
                        && actionRect.height > 0
                        && action.getClientRects().length
                        && actionStyle.display !== "none"
                        && actionStyle.visibility !== "hidden"
                        && actionStyle.opacity !== "0"
                    ),
                    positiveGeometry: Boolean(actionRect?.width > 0 && actionRect?.height > 0),
                    containedInCard: Boolean(
                        actionRect
                        && actionRect.left >= cardRect.left
                        && actionRect.right <= cardRect.right
                        && actionRect.top >= cardRect.top
                        && actionRect.bottom <= cardRect.bottom
                    ),
                    renderedTitleTextCount: titleTextRects.length,
                    avoidsTitleText: Boolean(
                        actionRect
                        && titleTextRects.every(textRect => !rectanglesOverlap(actionRect, textRect))
                    ),
                    avoidsAdjacentInteractiveContent: Boolean(
                        actionRect
                        && adjacentInteractiveRects.every(rect => !rectanglesOverlap(actionRect, rect))
                    ),
                    usable: Boolean(
                        action
                        && !action.disabled
                        && action.getAttribute("aria-disabled") !== "true"
                        && actionStyle.pointerEvents !== "none"
                    ),
                    bottomGap: actionRect ? cardRect.bottom - actionRect.bottom : 0,
                };
            },
        ),
        faq: {
            regionCount: document.querySelectorAll("#about .cbs-about__faq").length,
            itemCount: document.querySelectorAll("#about .cbs-about__faq-list details").length,
            sectionCount: document.querySelectorAll("body > section#faq, body > main > section#faq").length,
            title: document.getElementById("faqTitle")?.textContent.trim(),
            navLabel: document.querySelector('a[href="#about"]')?.textContent.trim(),
            layoutHeight: document.querySelector("#about .cbs-about__faq-list")?.getBoundingClientRect().height,
            supportsHover: window.matchMedia("(hover: hover) and (pointer: fine)").matches,
            marker: getComputedStyle(document.querySelector("#about .cbs-about__faq-list summary")).listStyleType,
            answerClipPath: getComputedStyle(document.querySelector("#about .cbs-about__faq-list details > p")).clipPath,
            answerBorderRadius: getComputedStyle(document.querySelector("#about .cbs-about__faq-list details > p")).borderRadius,
            answerBackgroundImage: getComputedStyle(document.querySelector("#about .cbs-about__faq-list details > p")).backgroundImage,
            openCount: document.querySelectorAll("#about .cbs-about__faq-list details[open]").length,
            headingAlignment: Math.abs(
                document.getElementById("aboutTitle").getBoundingClientRect().top
                - document.getElementById("faqTitle").getBoundingClientRect().top
            ),
            customerCareCount: Array.from(
                document.querySelectorAll("#about .cbs-about__faq-heading *"),
                node => node.textContent.trim().toLowerCase(),
            ).filter(text => text === "customer care").length,
            bodyFontFamilies: Array.from(
                document.querySelectorAll("#about h3, #about p, #about summary, #about summary span"),
                node => getComputedStyle(node).fontFamily,
            ),
            bodyFontWeights: Array.from(
                document.querySelectorAll("#about h3, #about p, #about summary, #about summary span"),
                node => getComputedStyle(node).fontWeight,
            ),
            mutedColor: getComputedStyle(document.querySelector("#about .cbs-scene__heading > p")).color,
            titleColor: getComputedStyle(document.getElementById("aboutTitle")).color,
            pillarDividerColor: getComputedStyle(document.querySelector("#about .cbs-scene__pillars > article")).borderTopColor,
            faqDividerColor: getComputedStyle(document.querySelector("#about .cbs-about__faq-list details")).borderTopColor,
            aboutTitleSize: getComputedStyle(document.getElementById("aboutTitle")).fontSize,
            storeTitleSize: getComputedStyle(document.querySelector("#products .section-title")).fontSize,
            aboutLeadGap: document.querySelector("#about .cbs-scene__heading > p").getBoundingClientRect().top
                - document.getElementById("aboutTitle").getBoundingClientRect().bottom,
        },
        contact: (() => {
            const section = document.getElementById("contact");
            const title = document.getElementById("contactTitle");
            const information = section.querySelector(".cbs-scene__contact-summary");
            const footer = section.querySelector(".cbs-scene__footer");
            const socialLinks = Array.from(section.querySelectorAll(".cbs-scene__social-link"));
            const contactInformation = section.querySelector(".cbs-scene__contact > div:first-child");
            const channels = section.querySelector(".cbs-scene__channels");
            const socialCta = section.querySelector(".cbs-scene__social-cta");
            const socialNote = section.querySelector(".cbs-scene__social-note");
            const conversationTitle = section.querySelector(".cbs-scene__contact h3");
            const email = section.querySelector(".cbs-scene__email");
            const supportText = section.querySelector(".cbs-scene__contact p");
            const sectionRect = section.getBoundingClientRect();
            const footerRect = footer.getBoundingClientRect();
            const informationRect = contactInformation.getBoundingClientRect();
            const channelsRect = channels.getBoundingClientRect();
            const socialCtaRect = socialCta.getBoundingClientRect();
            const socialNoteRect = socialNote.getBoundingClientRect();
            const conversationTitleRect = conversationTitle.getBoundingClientRect();
            const emailRect = email.getBoundingClientRect();
            const supportTextRect = supportText.getBoundingClientRect();
            const iconBoxes = socialLinks.map(link => link.getBoundingClientRect());
            const emailStyle = getComputedStyle(email);
            const copyPanels = Array.from(section.querySelectorAll(".cbs-scene__social-block, .cbs-scene__contact-card"));
            const titleStyle = getComputedStyle(title);
            const referenceTitleStyle = getComputedStyle(document.getElementById("aboutTitle"));
            const aboutRect = document.getElementById("about").getBoundingClientRect();
            const aboutTitleRect = document.getElementById("aboutTitle").getBoundingClientRect();
            const titleTypography = [
                titleStyle.fontFamily,
                titleStyle.fontSize,
                titleStyle.fontWeight,
                titleStyle.lineHeight,
                titleStyle.letterSpacing,
            ];
            const referenceTitleTypography = [
                referenceTitleStyle.fontFamily,
                referenceTitleStyle.fontSize,
                referenceTitleStyle.fontWeight,
                referenceTitleStyle.lineHeight,
                referenceTitleStyle.letterSpacing,
            ];
            const textTypography = Array.from(
                section.querySelectorAll("h3, p"),
                node => {
                    const style = getComputedStyle(node);
                    return [
                        style.fontFamily,
                        style.fontSize,
                        style.fontWeight,
                        style.lineHeight,
                        style.letterSpacing,
                        style.fontStyle,
                        style.textTransform,
                    ];
                },
            );
            const mutedColors = Array.from(
                section.querySelectorAll(".cbs-scene__heading p, .cbs-scene__contact h3, .cbs-scene__contact p"),
                node => getComputedStyle(node).color,
            );
            const footerTypography = Array.from(
                footer.querySelectorAll("span, a"),
                node => {
                    const style = getComputedStyle(node);
                    return [style.fontFamily, style.fontSize, style.fontWeight, style.color];
                },
            );
            return {
                socialCount: socialLinks.length,
                socialLabels: socialLinks.map(link => link.getAttribute("aria-label")),
                socialDestinations: socialLinks.map(link => link.href),
                socialVisibleText: socialLinks.map(link => link.textContent.trim()),
                socialIconCount: section.querySelectorAll(".cbs-scene__social-link i").length,
                linkedInCount: section.querySelectorAll('a[href*="linkedin.com"]').length,
                storePromptCount: Array.from(section.querySelectorAll("p")).filter(node => node.textContent.includes("Looking for a piece?")).length,
                description: information.textContent.trim(),
                socialCta: socialCta.textContent.trim(),
                socialNote: socialNote.textContent.trim(),
                socialTextAlign: getComputedStyle(socialCta).textAlign,
                emailNote: supportText.textContent.trim(),
                titleTopRatio: (title.getBoundingClientRect().top - sectionRect.top) / sectionRect.height,
                aboutTitleTopRatio: (aboutTitleRect.top - aboutRect.top) / aboutRect.height,
                titleLeftOffset: title.getBoundingClientRect().left - sectionRect.left,
                aboutTitleLeftOffset: aboutTitleRect.left - aboutRect.left,
                titleContained: title.getBoundingClientRect().top >= sectionRect.top
                    && title.getBoundingClientRect().bottom <= sectionRect.bottom
                    && title.getBoundingClientRect().left >= sectionRect.left
                    && title.getBoundingClientRect().right <= sectionRect.right,
                aboutTitleContained: aboutTitleRect.top >= aboutRect.top
                    && aboutTitleRect.bottom <= aboutRect.bottom
                    && aboutTitleRect.left >= aboutRect.left
                    && aboutTitleRect.right <= aboutRect.right,
                titleInformationGap: information.getBoundingClientRect().top - title.getBoundingClientRect().bottom,
                footerBottomGap: sectionRect.bottom - footerRect.bottom,
                footerTopRatio: (footerRect.top - sectionRect.top) / sectionRect.height,
                footerContained: footerRect.top >= sectionRect.top
                    && footerRect.bottom <= sectionRect.bottom,
                supportContained: supportTextRect.top >= sectionRect.top
                    && supportTextRect.bottom <= sectionRect.bottom,
                footerFollowsContent: footerRect.top >= supportTextRect.bottom,
                channelsFollowDescription: channelsRect.top >= information.getBoundingClientRect().bottom,
                channelsFollowCta: channelsRect.top >= socialCtaRect.bottom,
                channelsFollowNote: channelsRect.top >= socialNoteRect.bottom,
                contentCentered: Math.abs(
                    (informationRect.left + informationRect.width / 2)
                    - (sectionRect.left + sectionRect.width / 2)
                ),
                iconsAligned: Math.abs(iconBoxes[0].top - iconBoxes[1].top),
                iconSizeDifference: Math.abs(iconBoxes[0].width - iconBoxes[1].width),
                iconSize: iconBoxes[0].width,
                emailTypography: [emailStyle.fontFamily, emailStyle.fontWeight],
                copyPanelCount: copyPanels.length,
                copyPanelRadius: copyPanels.map(panel => getComputedStyle(panel).borderRadius),
                copyPanelBorders: copyPanels.map(panel => getComputedStyle(panel).borderTopStyle),
                copyPanelBackgrounds: copyPanels.map(panel => getComputedStyle(panel).backgroundColor),
                titleTypography,
                referenceTitleTypography,
                textTypography,
                mutedColors,
                footerTypography,
                bodyFontFamily: getComputedStyle(document.body).fontFamily,
                titleColor: titleStyle.color,
                titleSize: titleStyle.fontSize,
                conversationTopSpace: conversationTitleRect.top - informationRect.top,
                emailTitleGap: emailRect.top - conversationTitleRect.bottom,
                supportTextBelowEmail: supportTextRect.top - emailRect.bottom,
                contentFooterGap: footerRect.top - supportTextRect.bottom,
                copyLeft: informationRect.left,
                copyRight: informationRect.right,
                socialIconsLeft: Math.min(...iconBoxes.map(box => box.left)),
                socialTextLeft: socialCtaRect.left,
                sectionCenterX: sectionRect.left + sectionRect.width / 2,
            };
        })(),
        sceneGeometry: ["about", "contact"].map(id => {
            const element = document.getElementById(id);
            const rect = element.getBoundingClientRect();
            return {
                id,
                height: rect.height,
                clientHeight: element.clientHeight,
                scrollHeight: element.scrollHeight,
                borderTopWidth: getComputedStyle(element).borderTopWidth,
                backgroundColor: getComputedStyle(element).backgroundColor,
                backgroundImage: getComputedStyle(element).backgroundImage,
                contentContained: element.scrollHeight <= element.clientHeight + 1,
            };
        }),
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));

    expect(structure.sections).toEqual(PRIMARY_SECTIONS);
    expect(structure.galleryNodes).toBe(0);
    expect(structure.galleryLinks).toBe(0);
    expect(structure.formatsNodes).toBe(0);
    expect(structure.formatsLinks).toBe(0);
    expect(structure.customRequestsNodes).toBe(0);
    expect(structure.customRequestsLinks).toBe(0);
    expect(structure.processNodes).toBe(0);
    expect(structure.processLinks).toBe(0);
    expect(structure.quoteIds).toBe(0);
    expect(structure.navigation.linkCount).toBe(3);
    if (structure.viewportWidth >= 641) {
        expect(structure.navigation.toggleDisplay).toBe("none");
        expect(structure.navigation.linksDisplay).toBe("flex");
        expect(structure.navigation.linksDirection).toBe("row");
        expect(structure.navigation.linksInsideNav).toBe(true);
        expect(structure.navigation.logoSeparated).toBe(true);
    } else {
        expect(structure.navigation.toggleDisplay).not.toBe("none");
        expect(structure.navigation.linksDisplay).toBe("none");
    }
    expect(structure.productTitleWeights.length).toBeGreaterThan(0);
    expect(structure.productTitleWeights.every(weight => weight === "400")).toBe(true);
    expect(structure.productPagerStatuses.length).toBeGreaterThan(0);
    expect(structure.productPagerButtonCount).toBe(structure.productPagerStatuses.length * 2);
    expect(structure.productPagerStatuses.every(status => (
        status.position === "absolute"
        && status.width <= 1
        && status.clipPath === "inset(50%)"
    ))).toBe(true);
    expect(structure.productActionGeometry.length).toBeGreaterThan(0);
    expect(structure.productActionGeometry.every(item => item.hasAction)).toBe(true);
    expect(structure.productActionGeometry.every(item => item.visible)).toBe(true);
    expect(structure.productActionGeometry.every(item => item.positiveGeometry)).toBe(true);
    expect(structure.productActionGeometry.every(item => item.containedInCard)).toBe(true);
    expect(structure.productActionGeometry.every(item => item.renderedTitleTextCount > 0)).toBe(true);
    expect(structure.productActionGeometry.every(item => item.avoidsTitleText)).toBe(true);
    expect(structure.productActionGeometry.every(item => item.avoidsAdjacentInteractiveContent)).toBe(true);
    expect(structure.productActionGeometry.every(item => item.usable)).toBe(true);
    expect(
        structure.productActionGeometry.every(item => item.bottomGap >= 8),
        JSON.stringify(structure.productActionGeometry),
    ).toBe(true);
    for (const scene of structure.sceneGeometry) {
        expect(Math.abs(scene.height - structure.viewportHeight), scene.id).toBeLessThanOrEqual(1);
        expect(scene.contentContained, JSON.stringify(scene)).toBe(true);
        if (scene.id === "contact") {
            expect(scene.borderTopWidth).toBe("0px");
        }
    }
    expect(new Set(structure.sceneGeometry.map(scene => scene.backgroundColor)).size).toBe(1);
    expect(structure.sceneGeometry.every(scene => scene.backgroundImage === "none")).toBe(true);
    expect(structure.faq.regionCount).toBe(1);
    expect(structure.faq.itemCount).toBe(5);
    expect(structure.faq.sectionCount).toBe(0);
    expect(structure.faq.title).toBe("FAQ");
    expect(structure.faq.customerCareCount).toBe(0);
    expect(structure.faq.navLabel).toBe("About & FAQ");
    expect(structure.faq.marker).toBe("none");
    expect(structure.faq.answerClipPath).toBe("none");
    expect(parseFloat(structure.faq.answerBorderRadius)).toBeGreaterThanOrEqual(12);
    expect(structure.faq.answerBackgroundImage).toBe("none");
    if (structure.viewportWidth > 900) {
        expect(structure.faq.headingAlignment).toBeLessThanOrEqual(1);
        expect(structure.faq.aboutTitleSize).toBe(structure.faq.storeTitleSize);
        expect(structure.contact.titleSize).toBe(structure.faq.storeTitleSize);
        expect(structure.faq.aboutLeadGap).toBeGreaterThanOrEqual(14);
        expect(structure.contact.socialTextAlign).toBe("left");
    }
    if (structure.viewportWidth <= 600) {
        expect(structure.faq.openCount).toBe(0);
    } else {
        expect(structure.faq.openCount).toBe(1);
    }
    expect(new Set(structure.faq.bodyFontFamilies).size).toBe(1);
    expect(structure.faq.bodyFontWeights.every(weight => ["400", "600"].includes(weight))).toBe(true);
    expect(structure.faq.pillarDividerColor).toBe(structure.faq.faqDividerColor);
    expect(structure.faq.titleColor).not.toBe(structure.faq.mutedColor);
    expect(structure.contact.socialCount).toBe(2);
    expect(structure.contact.socialLabels).toEqual(["Instagram", "Facebook"]);
    expect(structure.contact.socialDestinations).toEqual([
        "https://www.instagram.com/ciclobeefstudio/",
        "https://www.facebook.com/ciclobeefstudio/",
    ]);
    expect(structure.contact.socialVisibleText).toEqual(["", ""]);
    expect(structure.contact.socialIconCount).toBe(2);
    expect(structure.contact.linkedInCount).toBe(0);
    expect(structure.contact.storePromptCount).toBe(0);
    expect(structure.contact.description).toBe("Customer care.");
    expect(structure.contact.socialCta).toBe("Follow CicloBeef Studio");
    expect(structure.contact.socialNote).toBe("Selected products and studio updates are also showcased on our social channels.");
    expect(structure.contact.emailNote).toBe("Email us for order questions, customer care, and general enquiries.");
    expect(structure.contact.titleTopRatio).toBeGreaterThan(0);
    expect(structure.contact.titleTopRatio).toBeLessThan(0.3);
    expect(structure.contact.aboutTitleTopRatio).toBeGreaterThan(0);
    expect(structure.contact.aboutTitleTopRatio).toBeLessThan(0.35);
    expect(structure.contact.titleContained).toBe(true);
    expect(structure.contact.aboutTitleContained).toBe(true);
    expect(structure.contact.titleInformationGap).toBeGreaterThanOrEqual(12);
    expect(structure.contact.footerBottomGap).toBeGreaterThanOrEqual(8);
    expect(structure.contact.footerContained).toBe(true);
    expect(structure.contact.supportContained).toBe(true);
    expect(structure.contact.footerFollowsContent).toBe(true);
    expect(structure.contact.channelsFollowDescription).toBe(true);
    expect(structure.contact.channelsFollowCta).toBe(true);
    expect(structure.contact.channelsFollowNote).toBe(true);
    if (structure.viewportWidth <= 900) {
        expect(structure.contact.contentCentered).toBeLessThanOrEqual(1);
    }
    if (structure.viewportWidth <= 600) {
        expect(Math.abs(
            structure.contact.titleLeftOffset - structure.contact.aboutTitleLeftOffset
        )).toBeLessThanOrEqual(1);
    }
    expect(structure.contact.iconsAligned).toBeLessThanOrEqual(1);
    expect(structure.contact.iconSizeDifference).toBeLessThanOrEqual(1);
    expect(structure.contact.iconSize).toBeGreaterThan(48);
    expect(structure.contact.titleTypography).toEqual(structure.contact.referenceTitleTypography);
    for (const textStyle of structure.contact.textTypography) {
        expect(textStyle).toEqual(structure.contact.textTypography[0]);
    }
    expect(structure.contact.textTypography[0][2]).toBe("300");
    expect(structure.contact.copyPanelCount).toBe(2);
    expect(structure.contact.copyPanelRadius).toEqual(["0px", "0px"]);
    if (structure.viewportWidth > 900) {
        expect(structure.contact.copyPanelBorders).toEqual(["none", "none"]);
        expect(structure.contact.copyPanelBackgrounds).toEqual(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
    } else {
        expect(structure.contact.copyPanelBorders).toEqual(["solid", "solid"]);
    }
    expect(structure.contact.emailTypography[0]).toBe(structure.contact.textTypography[0][0]);
    expect(structure.contact.emailTypography[1]).toBe("600");
    expect(structure.faq.bodyFontFamilies[0]).toBe(structure.contact.textTypography[0][0]);
    expect(structure.contact.textTypography[0][0]).toContain("ui-monospace");
    expect(structure.contact.textTypography[0][0]).not.toContain("Courier New");
    expect(new Set(structure.contact.mutedColors)).toEqual(new Set([structure.faq.mutedColor]));
    expect(structure.contact.titleColor).not.toBe(structure.faq.mutedColor);
    for (const footerStyle of structure.contact.footerTypography) {
        expect(footerStyle).toEqual(structure.contact.footerTypography[0]);
    }
    expect(structure.contact.footerTypography[0][0]).toBe(structure.contact.bodyFontFamily);
    expect(structure.contact.footerTypography[0][0]).not.toContain("ui-monospace");
    expect(structure.contact.footerTypography[0][3]).not.toBe(structure.faq.mutedColor);
    expect(structure.contact.emailTitleGap).toBeGreaterThanOrEqual(0);
    expect(structure.contact.emailTitleGap).toBeLessThanOrEqual(8);
    expect(structure.contact.supportTextBelowEmail).toBeGreaterThanOrEqual(0);
    expect(structure.contact.supportTextBelowEmail).toBeLessThanOrEqual(8);
    expect(structure.contact.contentFooterGap).toBeGreaterThanOrEqual(8);
    if (structure.viewportWidth > 900) {
        expect(structure.contact.copyRight).toBeLessThan(structure.contact.sectionCenterX);
        expect(structure.contact.socialIconsLeft).toBeGreaterThan(structure.contact.sectionCenterX);
        expect(Math.abs(structure.contact.socialIconsLeft - structure.contact.socialTextLeft)).toBeLessThanOrEqual(1);
    } else {
        expect(structure.contact.footerTopRatio).toBeGreaterThanOrEqual(0.75);
    }
    expect(structure.horizontalOverflow).toBe(false);

    const faqItems = page.locator("#about .cbs-about__faq-list details");
    for (let index = 0; index < await faqItems.count(); index += 1) {
        const item = faqItems.nth(index);
        if (await item.getAttribute("open") === null) {
            if (structure.faq.supportsHover) {
                await item.locator("summary").hover();
            } else {
                await item.locator("summary").click();
            }
        }
        await expect(item).toHaveAttribute("open", "");
        const expandedState = await page.evaluate(() => {
            const about = document.getElementById("about");
            const contact = document.getElementById("contact");
            const aboutRect = about.getBoundingClientRect();
            const contactRect = contact.getBoundingClientRect();
            const answerRect = document.querySelector("#about .cbs-about__faq-list details[open] > p").getBoundingClientRect();
            return {
                contentContained: about.scrollHeight <= about.clientHeight + 1,
                answerContained: answerRect.top >= aboutRect.top && answerRect.bottom <= aboutRect.bottom,
                sectionsOverlap: aboutRect.bottom > contactRect.top + 1,
                faqHeight: document.querySelector("#about .cbs-about__faq-list").getBoundingClientRect().height,
                horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
            };
        });
        expect(expandedState.contentContained).toBe(true);
        expect(expandedState.answerContained).toBe(true);
        expect(expandedState.sectionsOverlap).toBe(false);
        expect(Math.abs(expandedState.faqHeight - structure.faq.layoutHeight)).toBeLessThanOrEqual(1);
        expect(expandedState.horizontalOverflow).toBe(false);
    }
});
