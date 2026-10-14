async function inspectElement(locator) {
    const count = await locator.count();
    if (!count) {
        return {
            exists: false,
            visible: false,
            boundingBox: null,
            computed: null,
            insideViewport: false,
            nonZeroBoundingBox: false,
            clippedByOverflowAncestor: false,
        };
    }

    const target = locator.first();
    const [visible, boundingBox, runtime] = await Promise.all([
        target.isVisible().catch(() => false),
        target.boundingBox().catch(() => null),
        target.evaluate(element => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            let clippedByOverflowAncestor = false;
            let ancestor = element.parentElement;

            while (ancestor) {
                const ancestorStyle = getComputedStyle(ancestor);
                const clipsX = ["hidden", "clip", "scroll", "auto"].includes(ancestorStyle.overflowX);
                const clipsY = ["hidden", "clip", "scroll", "auto"].includes(ancestorStyle.overflowY);
                if (clipsX || clipsY) {
                    const ancestorRect = ancestor.getBoundingClientRect();
                    const clippedX = clipsX && (rect.left < ancestorRect.left || rect.right > ancestorRect.right);
                    const clippedY = clipsY && (rect.top < ancestorRect.top || rect.bottom > ancestorRect.bottom);
                    if (clippedX || clippedY) {
                        clippedByOverflowAncestor = true;
                        break;
                    }
                }
                ancestor = ancestor.parentElement;
            }

            return {
                attributes: {
                    className: element.getAttribute("class"),
                    hidden: element.hasAttribute("hidden"),
                    ariaHidden: element.getAttribute("aria-hidden"),
                    disabled: "disabled" in element ? element.disabled : null,
                },
                computed: {
                    display: style.display,
                    visibility: style.visibility,
                    opacity: style.opacity,
                    width: style.width,
                    height: style.height,
                    position: style.position,
                    top: style.top,
                    right: style.right,
                    bottom: style.bottom,
                    left: style.left,
                    zIndex: style.zIndex,
                    overflow: style.overflow,
                    overflowX: style.overflowX,
                    overflowY: style.overflowY,
                    color: style.color,
                    backgroundColor: style.backgroundColor,
                    border: style.border,
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight,
                    pointerEvents: style.pointerEvents,
                    transform: style.transform,
                    gridColumn: style.gridColumn,
                    gridRow: style.gridRow,
                    flex: style.flex,
                },
                insideViewport: rect.bottom > 0
                    && rect.right > 0
                    && rect.top < viewportHeight
                    && rect.left < viewportWidth,
                nonZeroBoundingBox: rect.width > 0 && rect.height > 0,
                clippedByOverflowAncestor,
                centerHitTarget: (() => {
                    if (rect.width <= 0 || rect.height <= 0) return false;
                    const target = document.elementFromPoint(
                        rect.left + (rect.width / 2),
                        rect.top + (rect.height / 2),
                    );
                    return target === element || element.contains(target);
                })(),
            };
        }).catch(() => ({
            computed: null,
            insideViewport: false,
            nonZeroBoundingBox: false,
            clippedByOverflowAncestor: false,
            centerHitTarget: false,
        })),
    ]);

    return {
        exists: true,
        visible,
        boundingBox,
        ...runtime,
    };
}

function diagnoseInspection(inspection) {
    if (!inspection.exists) return "DOM_MISSING";
    if (inspection.computed?.display === "none") return "DISPLAY_NONE";
    if (inspection.computed?.visibility === "hidden") return "VISIBILITY_HIDDEN";
    if (Number(inspection.computed?.opacity) === 0) return "OPACITY_ZERO";
    if (!inspection.nonZeroBoundingBox) return "ZERO_SIZE";
    if (!inspection.insideViewport) return "OUTSIDE_VIEWPORT";
    if (inspection.clippedByOverflowAncestor) return "PARENT_CLIPPING";
    if (inspection.computed?.pointerEvents === "none") return "POINTER_EVENTS_DISABLED";
    if (!inspection.centerHitTarget) return "CENTER_OCCLUDED";
    if (inspection.attributes?.disabled) return "DISABLED";
    if (!inspection.visible) return "UNKNOWN_RUNTIME_CONDITION";
    return "VISIBLE";
}

module.exports = { diagnoseInspection, inspectElement };
