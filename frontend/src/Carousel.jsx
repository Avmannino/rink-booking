import React, { useEffect, useRef, useState } from "react";

export default function Carousel({
  images = [],       // array of string URLs
  interval = 4000,   // ms between slides
  ariaLabel = "Image carousel"
}) {
  const [index, setIndex] = useState(0);
  const timerRef = useRef(null);
  const containerRef = useRef(null);

  // autoplay
  useEffect(() => {
    start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, images, interval]);

  const start = () => {
    stop();
    timerRef.current = setTimeout(() => {
      setIndex((i) => (i + 1) % images.length);
    }, interval);
  };
  const stop = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const goTo = (i) => setIndex((i + images.length) % images.length);
  const prev = () => goTo(index - 1);
  const next = () => goTo(index + 1);

  // pause on hover/focus
  const onMouseEnter = () => stop();
  const onMouseLeave = () => start();
  const onFocus = () => stop();
  const onBlur = () => start();

  // keyboard nav
  const onKeyDown = (e) => {
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
  };

  if (!images.length) return null;

  return (
    <div
      className="carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      tabIndex={0}
      ref={containerRef}
    >
      <div
        className="carouselTrack"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {images.map((src, i) => (
          <div className="carouselSlide" key={i} aria-hidden={i !== index}>
            <img src={src} alt={`Slide ${i + 1}`} />
          </div>
        ))}
      </div>

      <button className="carouselBtn prev" onClick={prev} aria-label="Previous slide">‹</button>
      <button className="carouselBtn next" onClick={next} aria-label="Next slide">›</button>

      <div className="carouselDots" role="tablist" aria-label="Slide dots">
        {images.map((_, i) => (
          <button
            key={i}
            className={"dot" + (i === index ? " active" : "")}
            onClick={() => goTo(i)}
            role="tab"
            aria-selected={i === index}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
