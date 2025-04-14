// script.js

document.getElementById("contact-form").addEventListener("submit", function (e) {
  e.preventDefault();
  const responseBox = document.getElementById("form-response");

  responseBox.textContent = "Invio in corso...";
  responseBox.style.color = "#00ffe7";

  setTimeout(() => {
    responseBox.textContent = "Messaggio inviato con successo! Ti contatteremo presto.";
  }, 1500);
});

// Scroll animations con GSAP
gsap.registerPlugin(ScrollTrigger);

gsap.utils.toArray("section").forEach((section) => {
  gsap.from(section, {
    scrollTrigger: {
      trigger: section,
      start: "top 80%",
    },
    opacity: 0,
    y: 50,
    duration: 1,
    ease: "power2.out",
  });
});

// Cambia colore header al scroll
document.addEventListener("scroll", () => {
  const header = document.querySelector(".header");
  if (window.scrollY > 50) {
    header.style.background = "rgba(0, 0, 0, 0.9)";
  } else {
    header.style.background = "rgba(0, 0, 0, 0.7)";
  }
});

// Menu a tendina responsive
const menuToggle = document.createElement("div");
menuToggle.classList.add("menu-toggle");
menuToggle.innerHTML = `<span></span><span></span><span></span>`;

const nav = document.querySelector(".nav");
const navLinks = document.createElement("div");
navLinks.classList.add("nav-links");
navLinks.innerHTML = `
  <a href="#hero">Home</a>
  <a href="#services">Servizi</a>
  <a href="#about">Chi siamo</a>
  <a href="#contact">Contatti</a>
`;

nav.innerHTML = "";
nav.appendChild(menuToggle);
nav.appendChild(navLinks);

menuToggle.addEventListener("click", () => {
  navLinks.classList.toggle("show");
});
