const App = (() => {
  const init = () => {
    initNavigation();
    initVanta();
    initAnimations();
    initForm();
  };

  const initNavigation = () => {
    const menuToggle = document.querySelector('.menu-toggle');
    const navLinks = document.querySelector('.nav-links');
    const dropdowns = document.querySelectorAll('.dropdown');

    // Menu mobile
    menuToggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      menuToggle.classList.toggle('active');
      navLinks.classList.toggle('active');
      document.body.classList.toggle('no-scroll');
    });

    // Chiusura al click esterno
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.nav')) {
        menuToggle?.classList.remove('active');
        navLinks?.classList.remove('active');
        document.body.classList.remove('no-scroll');
      }
    });

    // Dropdown
    dropdowns.forEach(dropdown => {
      const btn = dropdown.querySelector('.dropbtn');
      const content = dropdown.querySelector('.dropdown-content');

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        content.classList.toggle('open');
        btn.setAttribute('aria-expanded', content.classList.contains('open'));
      });
    });
  };

  // Resto delle funzioni mantenuto
  // ...

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
