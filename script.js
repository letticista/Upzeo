document.addEventListener('DOMContentLoaded', () => {
  // INIZIALIZZA SFONDO 3D
  try {
    if (window.VANTA && typeof window.VANTA.WAVES === 'function') { // Aggiunto controllo window.
      const vantaEffect = VANTA.WAVES({
        el: "#3d-background",
        mouseControls: true,
        touchControls: true, // Assicurati sia true per mobile
        gyroControls: false,
        minHeight: 200.00,
        minWidth: 200.00,
        scale: 1.00,
        scaleMobile: 1.00, // Puoi provare a ridurre scaleMobile se Vanta è pesante
        color: 0x0,
        shininess: 50.00,
        waveHeight: 15.00,
        waveSpeed: 0.8,
        zoom: 0.75
      });
    } else {
      console.warn("VANTA o VANTA.WAVES non è definito. Sfondo 3D non caricato.");
      document.getElementById('3d-background').style.backgroundColor = '#0a0a0a'; // Fallback
    }
  } catch (error) {
      console.error("Errore durante l'inizializzazione di Vanta:", error);
      document.getElementById('3d-background').style.backgroundColor = '#0a0a0a'; // Fallback
  }


  // GESTIONE MENU MOBILE
  const menuToggle = document.querySelector('.menu-toggle');
  const navMenu = document.querySelector('.nav-menu');

  if (menuToggle && navMenu) {
    // === MODIFICA CHIAVE: Usiamo 'touchstart' invece di 'click' ===
    menuToggle.addEventListener('touchstart', (event) => {
      // event.preventDefault(); // Previene azioni default del browser (scroll, zoom) al tocco.
                                // Prova ad abilitarlo (togliendo //) se il menu si apre ma la pagina fa cose strane.
                                // Prova a disabilitarlo (lasciando //) se il menu NON si apre.
      console.log("--- MENU TOGGLE TOUCHSTART RILEVATO! ---"); // Log per debugging
      navMenu.classList.toggle('active');
      menuToggle.classList.toggle('active');
      document.body.classList.toggle('no-scroll', navMenu.classList.contains('active'));
    }, { passive: false }); // Aggiunto { passive: false } per permettere preventDefault, se necessario.

    // Opzionale: Aggiungere anche un listener 'click' come fallback? Potrebbe complicare. Meglio testare solo touchstart prima.

  } else {
      console.error("Elementi .menu-toggle o .nav-menu non trovati nel DOM.");
  }

  // CHIUDI MENU AL CLICK SU LINK O ESTERNO (SOLO MOBILE)
  const closeMobileMenu = () => {
    if (navMenu.classList.contains('active')) {
        console.log("Chiusura menu mobile...");
        navMenu.classList.remove('active');
        menuToggle.classList.remove('active');
        document.body.classList.remove('no-scroll');
    }
  };

  // Chiudi se si clicca su un link del menu (usiamo 'click' qui, va bene)
  navMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', (event) => {
          console.log("Link menu cliccato, chiudo menu.");
          // Non prevenire default se è un link vero a #sezione
          closeMobileMenu();
      });
  });

  // Chiudi se si tocca fuori dal menu (usiamo 'touchstart' per coerenza con l'apertura)
  document.addEventListener('touchstart', (e) => {
      if (navMenu.classList.contains('active') &&
          !navMenu.contains(e.target) &&
          !menuToggle.contains(e.target)) {
          console.log("Tocco fuori dal menu, chiudo.");
          closeMobileMenu();
      }
  });


  // ANIMAZIONE NUMERI STATISTICHE (Codice invariato da prima)
  const statsSection = document.querySelector('#hero .stats-grid');
  if (statsSection && 'IntersectionObserver' in window) {
      const animateNumbers = (entries, observer) => {
          entries.forEach(entry => {
              if (entry.isIntersecting) {
                  const counters = entry.target.querySelectorAll('.stat-number');
                  counters.forEach(counter => {
                      if (!counter.classList.contains('animated')) {
                          const target = +counter.dataset.count;
                          let count = 0;
                          const suffix = counter.textContent.includes('+') ? '+' : '';
                          const percentage = counter.textContent.includes('%') ? '%' : '';
                          counter.textContent = count + suffix + percentage; // Mostra 0 inizialmente

                          const updateCount = () => {
                              const increment = Math.max(1, Math.ceil(target / 100));
                              if (count < target) {
                                  count = Math.min(count + increment, target); // Incrementa e non supera target
                                  counter.textContent = count + suffix + percentage;
                                  requestAnimationFrame(updateCount);
                              } else {
                                  counter.textContent = target + suffix + percentage; // Assicura valore finale esatto
                                  counter.classList.add('animated');
                              }
                          };
                          // Piccolo ritardo prima di iniziare per visibilità iniziale '0'
                          setTimeout(updateCount, 50);
                      }
                  });
                  observer.unobserve(entry.target);
              }
          });
      };
      const observer = new IntersectionObserver(animateNumbers, { threshold: 0.3 }); // Leggermente prima
      observer.observe(statsSection);
  } else if (statsSection) {
     console.warn("IntersectionObserver non supportato.");
     document.querySelectorAll('.stat-number').forEach(counter => {
         counter.textContent = counter.dataset.count + (counter.textContent.includes('+') ? '+' : '') + (counter.textContent.includes('%') ? '%' : '');
     });
  }


  // GESTIONE DROPDOWN (Codice invariato da prima)
  const dropdowns = document.querySelectorAll('.dropdown');
  dropdowns.forEach(dropdown => {
      const button = dropdown.querySelector('.dropdown-btn');
      const content = dropdown.querySelector('.dropdown-content');

      if (button && content) {
          button.addEventListener('click', (e) => { // Usiamo 'click' qui, di solito va bene anche su mobile per i dropdown
              e.stopPropagation();
              // Chiudi altri dropdown
              document.querySelectorAll('.dropdown-content.active').forEach(activeContent => {
                  if (activeContent !== content) {
                      activeContent.classList.remove('active');
                  }
              });
              // Toggle corrente
              content.classList.toggle('active');
              console.log("Dropdown toggled:", content.classList.contains('active'));
          });
      }
  });

  // CHIUDI TUTTI I DROPDOWN AL CLICK ESTERNO (Usiamo 'click', va bene)
  document.addEventListener('click', (e) => {
      let clickedInsideADropdown = false;
      dropdowns.forEach(dropdown => {
          if (dropdown.contains(e.target)) {
              clickedInsideADropdown = true;
          }
      });

      if (!clickedInsideADropdown) {
          document.querySelectorAll('.dropdown-content.active').forEach(activeContent => {
              activeContent.classList.remove('active');
              console.log("Chiuso dropdown per click esterno");
          });
      }
  });

}); // Fine DOMContentLoaded
