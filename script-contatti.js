// --- SCRIPT SPECIFICO PER CONTATTI.HTML ---

document.addEventListener('DOMContentLoaded', () => {

    console.log("Contatti Script Loaded"); // Messaggio per conferma

    // === Inizializzazione Sfondo Vanta ===
    let vantaEffect = null; // Variabile per tenere traccia dell'effetto
    try {
        const vantaContainer = document.getElementById('vanta-canvas');
        if (vantaContainer && window.VANTA && typeof window.VANTA.WAVES === 'function') {
            vantaEffect = VANTA.WAVES({
                el: "#vanta-canvas", // Usa il div interno
                mouseControls: true,
                touchControls: true,
                gyroControls: false,
                minHeight: 200.00,
                minWidth: 200.00,
                scale: 1.00,
                scaleMobile: 0.8, // Leggermente meno intenso su mobile
                color: 0x101012,  // Corrisponde a --dark-bg
                shininess: 40.00,
                waveHeight: 18.00, // Onde leggermente più alte
                waveSpeed: 0.7,
                zoom: 0.80
            });
            console.log("Vanta Initialized");
        } else {
            console.warn("Vanta container or library not found.");
            document.getElementById('3d-background-container').style.backgroundColor = '#101012';
        }
    } catch (error) {
        console.error("Error initializing Vanta:", error);
        document.getElementById('3d-background-container').style.backgroundColor = '#101012';
    }

    // === Gestione Header Scrolled (Opzionale) ===
    const header = document.querySelector('.glass-header');
    if (header) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) {
                header.classList.add('scrolled');
            } else {
                header.classList.remove('scrolled');
            }
        });
    }

    // === Gestione Menu Mobile (Logica Replicata/Adattata) ===
    const menuToggle = document.querySelector('.menu-toggle');
    const navMenu = document.querySelector('.nav-menu');
    const body = document.body;

    if (menuToggle && navMenu) {
        menuToggle.addEventListener('touchstart', handleMenuToggle, { passive: false }); // Usa touchstart
        // Fallback click per accessibilità/desktop se touch non disponibile?
        // menuToggle.addEventListener('click', handleMenuToggle);

        function handleMenuToggle(event) {
            // event.preventDefault(); // Prova a decommentare se crea problemi su mobile
            console.log("Menu Toggle Event");
            const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true';

            navMenu.classList.toggle('active');
            menuToggle.classList.toggle('active');
            menuToggle.setAttribute('aria-expanded', !isExpanded);
            body.classList.toggle('no-scroll', !isExpanded);
        }

        // Chiusura menu cliccando sui link (per links # interni o altre pagine)
        navMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                if (navMenu.classList.contains('active')) {
                    console.log("Closing menu via link click");
                    navMenu.classList.remove('active');
                    menuToggle.classList.remove('active');
                    menuToggle.setAttribute('aria-expanded', 'false');
                    body.classList.remove('no-scroll');
                }
            });
        });

        // Chiusura menu toccando fuori (touchstart)
        document.addEventListener('touchstart', (e) => {
            if (navMenu.classList.contains('active') &&
                !navMenu.contains(e.target) &&
                !menuToggle.contains(e.target)) {
                console.log("Closing menu via outside touch");
                navMenu.classList.remove('active');
                menuToggle.classList.remove('active');
                menuToggle.setAttribute('aria-expanded', 'false');
                body.classList.remove('no-scroll');
            }
        }, { passive: true }); // Passive true qui ok, non serve preventDefault

    } else {
        console.error(".menu-toggle or .nav-menu not found.");
    }

    // === Gestione Dropdown (Logica Replicata/Adattata) ===
    const dropdowns = document.querySelectorAll('.dropdown');
    dropdowns.forEach(dropdown => {
        const button = dropdown.querySelector('.dropdown-btn');
        const content = dropdown.querySelector('.dropdown-content');

        if (button && content) {
            button.addEventListener('click', (e) => { // Click va bene per dropdown
                e.stopPropagation();
                const isExpanded = button.getAttribute('aria-expanded') === 'true';
                // Chiudi altri dropdown
                document.querySelectorAll('.dropdown-content.active').forEach(activeContent => {
                    if (activeContent !== content) {
                        activeContent.classList.remove('active');
                        activeContent.previousElementSibling.setAttribute('aria-expanded', 'false');
                    }
                });
                // Toggle corrente
                content.classList.toggle('active');
                button.setAttribute('aria-expanded', !isExpanded);
                console.log("Dropdown toggled");
            });
        }
    });
    // Chiudi dropdown cliccando fuori
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            document.querySelectorAll('.dropdown-content.active').forEach(activeContent => {
                activeContent.classList.remove('active');
                activeContent.previousElementSibling.setAttribute('aria-expanded', 'false');
            });
        }
    });


    // === NUOVO: Animazioni allo Scroll con Intersection Observer ===
    const animatedElements = document.querySelectorAll('.animate-on-scroll');

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    console.log("Element intersecting:", entry.target.classList);
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target); // Anima solo una volta
                }
            });
        }, {
            threshold: 0.1 // Trigger quando il 10% dell'elemento è visibile
        });

        animatedElements.forEach(el => observer.observe(el));
        console.log(`Observing ${animatedElements.length} elements for scroll animation.`);

    } else {
        console.warn("IntersectionObserver not supported, animations disabled.");
        // Fallback: mostra subito gli elementi se observer non è supportato
        animatedElements.forEach(el => el.classList.add('is-visible'));
    }


    // === NUOVO: Gestione Bottone Torna Su ===
    const backToTopButton = document.getElementById('back-to-top');
    if (backToTopButton) {
        window.addEventListener('scroll', () => {
            if (window.scrollY > 300) { // Mostra dopo 300px di scroll
                backToTopButton.classList.add('visible');
            } else {
                backToTopButton.classList.remove('visible');
            }
        });

        backToTopButton.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // === NUOVO: Aggiorna Anno Corrente nel Footer ===
    const yearSpan = document.getElementById('current-year');
    if (yearSpan) {
        yearSpan.textContent = new Date().getFullYear();
    }

    // === NUOVO: Smooth Scroll per Link Interni (se presenti) ===
    const smoothScrollLinks = document.querySelectorAll('.smooth-scroll');
    smoothScrollLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            // Controlla se è un link interno (#...)
            if (targetId && targetId.startsWith('#') && targetId.length > 1) {
                e.preventDefault(); // Previene il salto immediato
                const targetElement = document.getElementById(targetId.substring(1));
                if (targetElement) {
                    const headerOffset = document.querySelector('.glass-header')?.offsetHeight || 80; // Altezza header
                    const elementPosition = targetElement.getBoundingClientRect().top;
                    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                    window.scrollTo({
                        top: offsetPosition,
                        behavior: "smooth"
                    });
                    console.log(`Smooth scrolling to: ${targetId}`);
                }
            }
        });
    });


    // === Cleanup VantaJS on Page Unload (Opzionale ma buona pratica) ===
    window.addEventListener('beforeunload', () => {
        if (vantaEffect && typeof vantaEffect.destroy === 'function') {
            vantaEffect.destroy();
            console.log("Vanta Destroyed");
        }
    });

}); // Fine DOMContentLoaded
