import React, { useState } from 'react';

/**
 * Static “Additional Info” modal with an accordion.
 * - No inputs. You provide the text via the `sections` prop.
 * - Each section: { id, title, content } where `content` is a string or React node.
 *
 * Minimal class names used so it plays nicely with your existing CSS:
 *  - additionalInfoTrigger
 *  - ai-backdrop
 *  - ai-modal
 *  - ai-close
 *  - ai-accordion
 *  - ai-item
 *  - ai-header
 *  - ai-panel
 */
export default function AdditionalInfo({
  sections = [],
  triggerText = 'Additional Info',
}) {
  const [open, setOpen] = useState(false);
  const [openIdx, setOpenIdx] = useState(0); // which accordion item is open

  return (
    <>
      {/* Trigger text (place this absolutely/relatively in your CSS if desired) */}
      <button
        type="button"
        className="additionalInfoTrigger"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {triggerText}
      </button>

      {open && (
        <div className="ai-backdrop" role="dialog" aria-modal="true">
          <div className="ai-modal">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Additional Information</h3>
              <button
                type="button"
                className="ai-close"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="ai-accordion">
              {sections.map((sec, idx) => {
                const isOpen = idx === openIdx;
                return (
                  <div key={sec.id || idx} className="ai-item">
                    <button
                      type="button"
                      className="ai-header"
                      aria-expanded={isOpen}
                      onClick={() => setOpenIdx(isOpen ? -1 : idx)}
                    >
                      <span>{sec.title}</span>
                      <span aria-hidden="true">{isOpen ? '–' : '+'}</span>
                    </button>

                    {isOpen && (
                      <div className="ai-panel">
                        {/* You supply this content as plain text or JSX via props */}
                        {sec.content}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
