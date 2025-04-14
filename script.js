// Moduli ES6
const App = (() => {
  // Configurazione globale
  const config = {
    formSelector: '#contact-form',
    navSelector: '.nav-links',
    vantaOptions: {
      color: 0x00ffe7,
      waveSpeed: 1.2,
      zoom: 0.8
    }
  };

  // Inizializzazione
  const init = () => {
    setupVanta();
    setupAnimations();
    setupForm();
    setupNavigation();
    setupObservers();
  };

  // Effetto Vanta.js
  const setupVanta = () => {
    if (window.VANTA?.WAVES) {
      VANTA.WAVES({
        el: ".hero",
        mouseControls: true,
        touchControls: true,
        ...config.vantaOptions
      });
    }
  };

  // Animazioni GSAP
  const setupAnimations = () => {
    gsap.registerPlugin(ScrollTrigger);
    
    gsap.utils.toArray('section').forEach(section => {
      gsap.from(section, {
        opacity: 0,
        y: 100,
        duration: 1,
        scrollTrigger: {
          trigger: section,
          start: 'top 80%',
          toggleActions: 'play none none reverse'
        }
      });
    });
  };

  // Gestione Form
  const setupForm = () => {
    const form = document.querySelector(config.formSelector);
    if (!form) return;

    const sanitize = text => text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      
      const formData = new FormData(form);
      const data = {
        name: sanitize(formData.get('name')),
        email: sanitize(formData.get('email')),
        message: sanitize(formData.get('message'))
      };

      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        
        if (!response.ok) throw new Error('Errore invio');
        showFeedback('Messaggio inviato con successo!', 'success');
      } catch (error) {
        showFeedback('Errore durante l\'invio. Riprova.', 'error');
      }
    });
  };

  // Navigazione responsive
  const setupNavigation = () => {
    const menuToggle = document.querySelector('.menu-toggle');
    const navLinks = document.querySelector(config.navSelector);

    menuToggle?.addEventListener('click', () => {
      menuToggle.classList.toggle('active');
      navLinks.classList.toggle('active');
    });
  };

  // Observer per performance
  const setupObservers = () => {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.card, .title').forEach(el => observer.observe(el));
  };

  // Feedback utente
  const showFeedback = (message, type) => {
    const feedback = document.createElement('div');
    feedback.className = `feedback ${type}`;
    feedback.textContent = message;
    document.body.appendChild(feedback);
    
    setTimeout(() => feedback.remove(), 3000);
  };

  return { init };
})();

// Avvio applicazione
document.addEventListener('DOMContentLoaded', App.init);
