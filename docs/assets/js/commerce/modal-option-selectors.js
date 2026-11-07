// Keep Shopify's selects as the source of truth. Only their touch presentation
// changes: options expand in the modal's flow, never in a native iframe popup.
const documents = new WeakMap();
const touchQuery = "(max-width: 1180px), (max-width: 1366px) and (hover: none) and (pointer: coarse)";

const styles = `
.cbs-modal-option-source { display: none !important; }
.cbs-modal-option { width: 100%; margin: 0 0 12px; color: #1a1a1a; }
.cbs-modal-option summary {
    box-sizing: border-box; display: flex; align-items: center;
    justify-content: space-between; gap: 12px; min-height: 48px;
    padding: 12px 14px; border: 1px solid #d6d6d6; border-radius: 6px;
    background: #fafafa; cursor: pointer; list-style: none;
    font: 400 16px/1.4 Inter, sans-serif; overflow-wrap: anywhere;
}
.cbs-modal-option summary::-webkit-details-marker { display: none; }
.cbs-modal-option summary::after {
    content: ''; flex: 0 0 7px; height: 7px; margin: -4px 2px 0 0;
    border-right: 1.5px solid; border-bottom: 1.5px solid; transform: rotate(45deg);
}
.cbs-modal-option[open] summary::after { transform: rotate(225deg); margin-top: 4px; }
.cbs-modal-option summary[aria-disabled="true"] { opacity: .55; cursor: wait; }
.cbs-modal-option-values {
    box-sizing: border-box; max-height: 224px; overflow-y: auto;
    overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
    margin-top: 6px; padding: 4px; border: 1px solid #d6d6d6;
    border-radius: 6px; background: #fafafa;
}
.cbs-modal-option-values button {
    box-sizing: border-box; display: flex; align-items: center;
    justify-content: space-between; gap: 12px; width: 100%; min-height: 48px;
    margin: 0; padding: 12px 10px; border: 0; border-radius: 3px;
    background: transparent; color: #1a1a1a; text-align: left;
    font: 400 16px/1.4 Inter, sans-serif; overflow-wrap: anywhere; cursor: pointer;
}
.cbs-modal-option-values button[aria-pressed="true"] { background: #e9e9e9; }
.cbs-modal-option-values button[aria-pressed="true"]::after { content: '✓'; }
.cbs-modal-option-values button:disabled { opacity: .45; cursor: default; }
.cbs-modal-option summary:focus-visible,
.cbs-modal-option-values button:focus-visible { outline: 2px solid #997500; outline-offset: -2px; }
`;

export function enhanceModalOptionSelectors(documentRef) {
    let state = documents.get(documentRef);
    if (!state) {
        const media = window.matchMedia(touchQuery);
        state = { media, controls: new Map(), focusName: null };
        documents.set(documentRef, state);
        const style = documentRef.createElement("style");
        style.textContent = styles;
        documentRef.head.append(style);
        media.addEventListener("change", () => enhanceModalOptionSelectors(documentRef));
        const observer = new documentRef.defaultView.MutationObserver(() => enhanceModalOptionSelectors(documentRef));
        observer.observe(documentRef.body, {
            subtree: true, childList: true, attributes: true,
            attributeFilter: ["disabled", "selected"],
        });
        documentRef.addEventListener("change", () => enhanceModalOptionSelectors(documentRef));
        documentRef.addEventListener("click", event => {
            state.controls.forEach(({ details }) => {
                if (!details.contains(event.target)) details.open = false;
            });
        });
    }

    state.controls.forEach((control, select) => {
        if (!select.isConnected || !state.media.matches) {
            control.details.remove();
            control.source.classList.remove("cbs-modal-option-source");
            state.controls.delete(select);
        }
    });
    if (!state.media.matches) return;

    documentRef.querySelectorAll(".shopify-buy__option-select select").forEach(select => {
        let control = state.controls.get(select);
        if (!control) {
            const source = select.closest(".shopify-buy__option-select-wrapper") ?? select;
            const details = documentRef.createElement("details");
            details.className = "cbs-modal-option";
            const summary = documentRef.createElement("summary");
            const values = documentRef.createElement("div");
            values.className = "cbs-modal-option-values";
            values.setAttribute("role", "group");
            values.setAttribute("aria-label", select.name);
            details.append(summary, values);
            source.after(details);
            source.classList.add("cbs-modal-option-source");
            control = { source, details, summary, values, signature: null };
            state.controls.set(select, control);
            summary.addEventListener("click", event => {
                if (select.disabled) event.preventDefault();
                if (!select.disabled && !details.open) {
                    const panel = details.closest(".shopify-buy__modal");
                    if (panel && documentRef.defaultView.getComputedStyle(panel).position !== "fixed") {
                        // Preserve the rendered product panel while its options expand in-flow.
                        panel.style.height = documentRef.defaultView.getComputedStyle(panel).height;
                    }
                }
            });
            details.addEventListener("toggle", () => {
                if (!details.open) return;
                const panel = details.closest(".shopify-buy__modal");
                if (!panel) return;
                const bottom = Math.min(panel.getBoundingClientRect().bottom, documentRef.defaultView.innerHeight) - 12;
                // Reveal options near the bottom of a small screen by scrolling
                // only the existing modal, leaving the storefront in place.
                panel.scrollTop += Math.max(0, details.getBoundingClientRect().bottom - bottom);
            });
            details.addEventListener("keydown", event => {
                if (event.key === "Escape" && details.open) {
                    event.preventDefault();
                    event.stopPropagation();
                    details.open = false;
                    summary.focus({ preventScroll: true });
                }
            });
        }
        const { details, summary, values } = control;
        const text = select.selectedOptions[0]?.textContent ?? "";
        if (summary.textContent !== text) summary.textContent = text;
        summary.setAttribute("aria-label", `${select.name}: ${text}`);
        summary.setAttribute("aria-disabled", String(select.disabled));
        if (select.disabled) details.open = false;
        const signature = JSON.stringify([...select.options].map(option => [option.value, option.text, option.disabled, option.selected]));
        if (control.signature !== signature) {
            control.signature = signature;
            values.replaceChildren(...[...select.options].map(option => {
                const button = documentRef.createElement("button");
                button.type = "button";
                button.textContent = option.text;
                button.disabled = option.disabled;
                button.setAttribute("aria-pressed", String(option.selected));
                button.addEventListener("click", event => {
                    // Shopify can replace the product synchronously on change.
                    // Don't let the original, now detached click reach its overlay.
                    event.preventDefault();
                    event.stopPropagation();
                    if (select.disabled) return;
                    details.open = false;
                    summary.focus({ preventScroll: true });
                    if (select.value === option.value) return;
                    state.focusName = select.name;
                    select.value = option.value;
                    select.dispatchEvent(new documentRef.defaultView.Event("change", { bubbles: true }));
                    enhanceModalOptionSelectors(documentRef);
                    documentRef.defaultView.requestAnimationFrame(() => {
                        state.controls.forEach((next, input) => {
                            if (input.name === state.focusName) next.summary.focus({ preventScroll: true });
                        });
                        state.focusName = null;
                    });
                });
                return button;
            }));
        }
    });
}
