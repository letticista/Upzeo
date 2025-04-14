// script.js

// Form submission logic

const form = document.getElementById("contact-form");
const responseBox = document.getElementById("form-response");

form?.addEventListener("submit", function (e) {
  e.preventDefault();
  responseBox.textContent = "Invio in corso...";
  responseBox.style.color = "#00ffe7";

  setTimeout(() => {
    responseBox.textContent = "Messaggio inviato con successo! Ti contatteremo presto.";
    responseBox.style.color = "#00ff77";
  }, 1500);
});

// GSAP animations

gsap.registerPlugin(ScrollTrigger);

// Global scroll animations
const sections = gsap.utils.toArray("section");

sections.forEach((section) => {
  gsap.from(section, {
    scrollTrigger: {
      trigger: section,
      start: "top 80%",
      toggleActions: "play none none none",
    },
    opacity: 0,
    y: 50,
    duration: 1.2,
    ease: "power4.out",
  });
});

// Sticky header effect
const header = document.querySelector(".header");

window.addEventListener("scroll", () => {
  if (window.scrollY > 50) {
    header.classList.add("scrolled");
  } else {
    header.classList.remove("scrolled");
  }
});

// Advanced dropdown menu
const nav = document.querySelector(".nav");
const navWrapper = document.createElement("div");
navWrapper.classList.add("nav-wrapper");

const menuToggle = document.createElement("div");
menuToggle.classList.add("menu-toggle");
menuToggle.innerHTML = `
  <span class="bar"></span>
  <span class="bar"></span>
  <span class="bar"></span>
`;

const navLinks = document.createElement("div");
navLinks.classList.add("nav-links");
navLinks.innerHTML = `
  <a href="#hero">Home</a>
  <a href="#services">Servizi</a>
  <div class="dropdown">
    <a class="dropbtn">Chi siamo</a>
    <div class="dropdown-content">
      <a href="#team">Il nostro team</a>
      <a href="#storia">La nostra storia</a>
      <a href="#missione">Missione</a>
    </div>
  </div>
  <a href="#contact">Contatti</a>
`;

menuToggle.addEventListener("click", () => {
  navLinks.classList.toggle("show");
  menuToggle.classList.toggle("open");
});

navWrapper.appendChild(menuToggle);
navWrapper.appendChild(navLinks);
nav.innerHTML = "";
nav.appendChild(navWrapper);

// Optional: Close menu on link click (mobile UX improvement)
document.querySelectorAll(".nav-links a").forEach(link => {
  link.addEventListener("click", () => {
    if (navLinks.classList.contains("show")) {
      navLinks.classList.remove("show");
      menuToggle.classList.remove("open");
    }
  });
});
