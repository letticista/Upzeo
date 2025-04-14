document.addEventListener('DOMContentLoaded', () => {
  // MENU MOBILE
  const menuToggle = document.querySelector('.menu-toggle');
  const navList = document.querySelector('.nav-list');
  
  menuToggle?.addEventListener('click', () => {
    menuToggle.classList.toggle('active');
    navList.classList.toggle('active');
    
    // Animazione hamburger menu
    if(menuToggle.classList.contains('active')) {
      menuToggle.children[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
      menuToggle.children[1].style.opacity = '0';
      menuToggle.children[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
    } else {
      menuToggle.children[0].style.transform = 'none';
      menuToggle.children[1].style.opacity = '1';
      menuToggle.children[2].style.transform = 'none';
    }
  });

  // CHIUSURA MENU AL CLICK SU LINK
  document.querySelectorAll('.nav-list a').forEach(link => {
    link.addEventListener('click', () => {
      navList.classList.remove('active');
      menuToggle.classList.remove('active');
    });
  });

  // DROPDOWN PER MOBILE
  const dropdowns = document.querySelectorAll('.dropdown');
  
  dropdowns.forEach(dropdown => {
    const link = dropdown.querySelector('a');
    
    link.addEventListener('click', (e) => {
      if(window.innerWidth <= 768) {
        e.preventDefault();
        const menu = dropdown.querySelector('.dropdown-menu');
        menu.style.maxHeight = menu.style.maxHeight ? null : '300px';
      }
    });
  });
});
