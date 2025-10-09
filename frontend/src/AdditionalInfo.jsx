import React, { useEffect, useRef, useState } from "react";

/**
 * Props:
 * - sections: [{ id, title, content }]
 * - triggerText?: string ("Additional Info" default)
 * - footerNote?: string (renders at bottom of modal)
 */
export default function AdditionalInfo({
  sections = [],
  triggerText = "Additional Info",
  footerNote,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [openSet, setOpenSet] = useState(() => new Set());
  const modalRef = useRef(null);

  // Open/close modal
  const openModal = () => setIsOpen(true);
  const closeModal = () => setIsOpen(false);

  // Close on Esc
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        closeModal();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [isOpen]);

  // Toggle an accordion item
  const toggle = (id) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      {/* Trigger text placed in your header area; style via .additionalInfoTrigger */}
      <button
        type="button"
        className="additionalInfoTrigger"
        onClick={openModal}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="additional-info-modal"
      >
        {triggerText}
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="ai-backdrop" role="presentation">
          <div
            id="additional-info-modal"
            ref={modalRef}
            className="ai-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Additional Information"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="ai-modalHeader">
              <h3>Additional Information</h3>
              <button
                className="ai-closeBtn"
                aria-label="Close"
                onClick={closeModal}
                type="button"
              >
                ×
              </button>
            </div>

            {/* Accordion body (card style) */}
            <div className="ai2-accordion">
              {sections.map(({ id, title, content }) => {
                const open = openSet.has(id);
                return (
                  <div key={id} className="ai2-item">
                    <button
                      id={`ai2-summary-${id}`}
                      type="button"
                      className="ai2-summary"
                      aria-expanded={open}
                      aria-controls={`ai2-panel-${id}`}
                      onClick={() => toggle(id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle(id);
                        }
                      }}
                    >
                      <span className="ai2-title">{title}</span>
                      <span className="ai2-sign" aria-hidden="true">
                        {open ? "–" : "+"}
                      </span>
                    </button>

                    <div
                      id={`ai2-panel-${id}`}
                      role="region"
                      aria-labelledby={`ai2-summary-${id}`}
                      className={`ai2-panel ${open ? "open" : ""}`}
                      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
                    >
                      <div className="ai2-panel-inner">{content}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer note (outside the accordion, at bottom of modal) */}
            {footerNote && <div className="ai2-footer">{footerNote}</div>}
          </div>
        </div>
      )}
    </>
  );
}
