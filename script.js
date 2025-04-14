// --- script.js ---

VANTA.FOG({
  el: "#vanta-bg",
  mouseControls: true,
  touchControls: true,
  minHeight: 200.00,
  minWidth: 200.00,
  highlightColor: 0xff00ff,
  midtoneColor: 0x000000,
  lowlightColor: 0x00fff7,
  baseColor: 0x000000,
  blurFactor: 0.6,
  speed: 1.50,
  zoom: 1.1
});

// GSAP animations

gsap.from(".main-header", {
  y: -100,
  opacity: 0,
  duration: 1,
  ease: "power4.out"
});

gsap.from(".hero-title", {
  delay: 0.5,
  y: 50,
  opacity: 0,
  duration: 1.2,
  ease: "power3.out"
});

gsap.from(".hero-subtitle", {
  delay: 0.8,
  y: 30,
  opacity: 0,
  duration: 1,
  ease: "power3.out"
});

gsap.from(".cta", {
  delay: 1.2,
  scale: 0.5,
  opacity: 0,
  duration: 1,
  ease: "elastic.out(1, 0.5)"
});

// Scroll animations

gsap.utils.toArray(".section").forEach(section => {
  gsap.from(section, {
    scrollTrigger: {
      trigger: section,
      start: "top 80%",
      toggleActions: "play none none none"
    },
    opacity: 0,
    y: 50,
    duration: 1,
    ease: "power2.out"
  });
});

// Contact form submission (no backend, just UX feedback)
document.querySelector(".contact-form").addEventListener("submit", function(e) {
  e.preventDefault();
  alert("Grazie per averci contattato! Ti risponderemo al più presto.");
  this.reset();
});
