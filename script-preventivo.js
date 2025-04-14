// --- SCRIPT SPECIFICO PER PREVENTIVO.HTML ---

document.addEventListener('DOMContentLoaded', () => {

    console.log("Preventivo Script Loaded");

    // === Inizializzazione Sfondo Vanta (Copia) ===
    let vantaEffect = null;
    try {
        const vantaContainer = document.getElementById('vanta-canvas');
        if (vantaContainer && window.VANTA && typeof window.VANTA.WAVES === 'function') {
            vantaEffect = VANTA.WAVES({
                el: "#vanta-canvas",
                mouseControls: true, touchControls: true, gyroControls: false,
                minHeight: 200.00, minWidth: 200.00, scale: 1.00, scaleMobile: 0.8,
                color: 0x101012, shininess: 40.00, waveHeight: 18.00, waveSpeed: 0.7, zoom: 0.80
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

    // === Gestione Header Scrolled (Copia) ===
    const header = document.querySelector('.glass-header');
    if (header) {
        window.addEventListener('scroll', () => {
            header.classList.toggle('scrolled', window.scrollY > 50);
        });
    }

    // === Gestione Menu Mobile (Copia) ===
    const menuToggle = document.querySelector('.menu-toggle');
    const navMenu = document.querySelector('.nav-menu');
    const body = document.body;
    if (menuToggle && navMenu) {
        menuToggle.addEventListener('touchstart', handleMenuToggle, { passive: false });
        function handleMenuToggle(event) {
            const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true';
            navMenu.classList.toggle('active');
            menuToggle.classList.toggle('active');
            menuToggle.setAttribute('aria-expanded', !isExpanded);
            body.classList.toggle('no-scroll', !isExpanded);
        }
        navMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                if (navMenu.classList.contains('active')) {
                    navMenu.classList.remove('active');
                    menuToggle.classList.remove('active');
                    menuToggle.setAttribute('aria-expanded', 'false');
                    body.classList.remove('no-scroll');
                }
            });
        });
        document.addEventListener('touchstart', (e) => {
            if (navMenu.classList.contains('active') && !navMenu.contains(e.target) && !menuToggle.contains(e.target)) {
                navMenu.classList.remove('active');
                menuToggle.classList.remove('active');
                menuToggle.setAttribute('aria-expanded', 'false');
                body.classList.remove('no-scroll');
            }
        }, { passive: true });
    } else { 
        console.error(".menu-toggle or .nav-menu not found."); 
    }

    // === Gestione Dropdown (Copia) ===
    const dropdowns = document.querySelectorAll('.dropdown');
    dropdowns.forEach(dropdown => {
        const button = dropdown.querySelector('.dropdown-btn');
        const content = dropdown.querySelector('.dropdown-content');
        if (button && content) {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const isExpanded = button.getAttribute('aria-expanded') === 'true';
                document.querySelectorAll('.dropdown-content.active').forEach(ac => {
                    if (ac !== content) { 
                        ac.classList.remove('active'); 
                        ac.previousElementSibling.setAttribute('aria-expanded', 'false'); 
                    }
                });
                content.classList.toggle('active'); 
                button.setAttribute('aria-expanded', !isExpanded);
            });
        }
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
            document.querySelectorAll('.dropdown-content.active').forEach(ac => {
                ac.classList.remove('active');
                ac.previousElementSibling.setAttribute('aria-expanded', 'false');
            });
        }
    });

    // === Animazioni allo Scroll (Copia) ===
    const animatedElements = document.querySelectorAll('.animate-on-scroll');
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 });
        animatedElements.forEach(el => observer.observe(el));
        console.log(`Observing ${animatedElements.length} elements for scroll animation.`);
    } else { 
        animatedElements.forEach(el => el.classList.add('is-visible')); 
    }

    // === Bottone Torna Su (Copia) ===
    const backToTopButton = document.getElementById('back-to-top');
    if (backToTopButton) {
        window.addEventListener('scroll', () => {
            backToTopButton.classList.toggle('visible', window.scrollY > 300);
        });
        backToTopButton.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    // === Anno Corrente Footer (Copia) ===
    const yearSpan = document.getElementById('current-year');
    if (yearSpan) { 
        yearSpan.textContent = new Date().getFullYear(); 
    }

    // === NUOVO: Gestione Form Preventivo (Validazione e Invio) ===
    const form = document.getElementById('quote-form');
    const statusMessage = document.getElementById('form-status-message');
    const submitButton = document.getElementById('submit-button');

    if (form && statusMessage && submitButton) {

        // Funzione per mostrare errori
        const showError = (inputElement, message) => {
            const formGroup = inputElement.closest('.form-group') || inputElement.closest('.checkbox-group') || inputElement.closest('.form-fieldset');
            const errorElement = formGroup?.querySelector('.error-message');
            if (errorElement) {
                errorElement.textContent = message;
                errorElement.style.visibility = 'visible'; // Sovrascrivi stile CSS se serve
                errorElement.style.opacity = '1';
            }
            formGroup?.classList.add('has-error');
            inputElement.setAttribute('aria-invalid', 'true');
        };

        // Funzione per rimuovere errori
        const clearError = (inputElement) => {
            const formGroup = inputElement.closest('.form-group') || inputElement.closest('.checkbox-group') || inputElement.closest('.form-fieldset');
            const errorElement = formGroup?.querySelector('.error-message');
            if (errorElement) {
                errorElement.textContent = '';
                errorElement.style.visibility = 'hidden';
                errorElement.style.opacity = '0';
            }
            formGroup?.classList.remove('has-error');
            inputElement.removeAttribute('aria-invalid');
        };

        // Funzione validazione email
        const isValidEmail = (email) => {
            const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return re.test(String(email).toLowerCase());
        };

        // Funzione validazione checkbox gruppo (almeno uno selezionato)
        const validateCheckboxGroup = (fieldsetElement, inputName) => {
            const checkboxes = fieldsetElement.querySelectorAll(`input[name="${inputName}"]:checked`);
            const errorContainer = document.getElementById(`${inputName}-error`) || fieldsetElement.querySelector('.error-message'); // Trova contenitore errore
            if (checkboxes.length === 0) {
                fieldsetElement.classList.add('has-error');
                if (errorContainer) {
                    errorContainer.textContent = 'Seleziona almeno un servizio.';
                    errorContainer.style.visibility = 'visible';
                    errorContainer.style.opacity = '1';
                }
                return false;
            } else {
                fieldsetElement.classList.remove('has-error');
                if (errorContainer) {
                    errorContainer.textContent = '';
                    errorContainer.style.visibility = 'hidden';
                    errorContainer.style.opacity = '0';
                }
                return true;
            }
        };

        // Validazione in tempo reale (on blur)
        form.querySelectorAll('input[required], textarea[required], select[required]').forEach(input => {
            input.addEventListener('blur', () => {
                clearError(input); // Pulisce errore precedente
                if (input.type === 'checkbox') {
                    if (!input.checked && input.required) {
                        showError(input, 'Questo campo è obbligatorio.');
                    }
                } else if (!input.value.trim()) {
                    showError(input, 'Questo campo è obbligatorio.');
                } else if (input.type === 'email' && !isValidEmail(input.value)) {
                    showError(input, 'Inserisci un indirizzo email valido.');
                }
            });
            // Pulisce errore anche scrivendo
            input.addEventListener('input', () => clearError(input));
        });

        // Gestione invio form
        form.addEventListener('submit', async (e) => {
            e.preventDefault(); // Previene invio HTML standard
            console.log("Form submission attempt...");

            let isValid = true;
            statusMessage.textContent = ''; // Pulisce messaggi stato
            statusMessage.className = ''; // Rimuove classi successo/errore

            // Validazione campi obbligatori
            form.querySelectorAll('input[required], textarea[required]').forEach(input => {
                clearError(input);
                if (input.type === 'checkbox') {
                    if (!input.checked) {
                        isValid = false;
                        showError(input, 'Devi accettare per procedere.');
                    }
                } else if (!input.value.trim()) {
                    isValid = false;
                    showError(input, 'Questo campo è obbligatorio.');
                } else if (input.type === 'email' && !isValidEmail(input.value)) {
                    isValid = false;
                    showError(input, 'Inserisci un indirizzo email valido.');
                }
            });

            // Validazione gruppo checkbox servizi
            const servicesFieldset = form.querySelector('fieldset legend')?.textContent.includes("Tipo di Servizio") ? form.querySelector('fieldset legend').closest('fieldset') : null;
            if (servicesFieldset && !validateCheckboxGroup(servicesFieldset, 'service_type')) {
                isValid = false;
                // Messaggio errore già gestito da validateCheckboxGroup
                const firstCheckbox = servicesFieldset.querySelector('input[type="checkbox"]');
                if(firstCheckbox) firstCheckbox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }

            if (!isValid) {
                console.log("Form validation failed.");
                statusMessage.textContent = 'Per favore, correggi gli errori nel modulo.';
                statusMessage.className = 'error';
                // Porta l'utente al primo errore
                const firstError = form.querySelector('.has-error');
                if (firstError) {
                    firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                return; // Blocca invio se non valido
            }

            // --- Invio Dati (Usando Fetch API) ---
            submitButton.disabled = true;
            submitButton.textContent = 'Invio in corso...';
            statusMessage.textContent = '';
            statusMessage.className = '';

            const formData = new FormData(form);
            // Converti i checkbox in una stringa separata da virgole (o altro formato) se necessario
            const services = Array.from(formData.getAll('service_type')).join(', ');
            formData.set('service_type_combined', services); // Aggiunge campo combinato

            // *** SOSTITUISCI CON IL TUO ENDPOINT (Formspree, Netlify, tuo backend) ***
            const ENDPOINT_URL = 'https://formspree.io/f/xkgjyllb'; // ESEMPIO con Formspree

            try {
                const response = await fetch(ENDPOINT_URL, {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'Accept': 'application/json' // Necessario per alcuni servizi (es. Formspree)
                    }
                });

                if (response.ok) {
                    // Successo
                    console.log("Form submitted successfully!");
                    statusMessage.textContent = 'Grazie! La tua richiesta è stata inviata con successo. Ti risponderemo al più presto.';
                    statusMessage.className = 'success';
                    form.reset(); // Resetta il form
                    // Pulisci tutti gli indicatori di errore manualmente se reset non basta
                    form.querySelectorAll('.has-error').forEach(el => el.classList.remove('has-error'));
                    form.querySelectorAll('.error-message').forEach(el => {
                        el.textContent = '';
                        el.style.visibility = 'hidden';
                        el.style.opacity = '0';
                    });
                    // Porta l'utente al messaggio di successo
                    statusMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });

                } else {
                    // Errore dalla risposta del server/servizio
                    const errorData = await response.json().catch(() => ({})); // Prova a leggere errore JSON
                    console.error("Form submission failed:", response.status, errorData);
                    statusMessage.textContent = `Si è verificato un errore durante l'invio (${response.status}). Riprova più tardi. ${errorData.error || ''}`;
                    statusMessage.className = 'error';
                }

            } catch (error) {
                // Errore di rete o JS
                console.error("Network or script error during form submission:", error);
                statusMessage.textContent = 'Errore di rete o script. Controlla la connessione e riprova.';
                statusMessage.className = 'error';
            } finally {
                // Riabilita il bottone indipendentemente dall'esito
                submitButton.disabled = false;
                submitButton.textContent = 'Invia Richiesta';
            }
        });

    } else {
        console.error("Form elements (#quote-form, #form-status-message, #submit-button) not found.");
    }

    // === Cleanup VantaJS (Copia) ===
    window.addEventListener('beforeunload', () => {
        if (vantaEffect && typeof vantaEffect.destroy === 'function') {
            vantaEffect.destroy();
            console.log("Vanta Destroyed");
        }
    });

}); // Fine DOMContentLoaded
// === Validazione del Form Preventivo ===
document.getElementById("quote-form").addEventListener("submit", function (e) {
    const serviceCheckboxes = document.querySelectorAll('input[name="service_type"]:checked');
    const errorMsg = document.getElementById("service_type-error");

    if (serviceCheckboxes.length === 0) {
        e.preventDefault();
        errorMsg.textContent = "Seleziona almeno un tipo di servizio.";
        errorMsg.style.color = "red";
        window.scrollTo({ top: errorMsg.offsetTop - 100, behavior: "smooth" });
    } else {
        errorMsg.textContent = ""; // rimuove l'errore se tutto ok
    }
});
