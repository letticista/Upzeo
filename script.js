// INIZIALIZZAZIONE 3D
document.addEventListener('DOMContentLoaded', () => {
  // Background 3D
  VANTA.GLOBE({
    el: "#3d-bg",
    color: 0x00ffe7,
    backgroundColor: 0x0a0a0a,
    size: 1.2,
    gyroControls: false
  });

  // Menu mobile
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');

  menuToggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    menuToggle.classList.toggle('active');
  });

  // Animazione numeri
  const animateNumbers = () => {
    const counters = document.querySelectorAll('.stat-number');
    const speed = 200;
    
    counters.forEach(counter => {
      const target = +counter.getAttribute('data-count');
      const count = +counter.innerText;
      const increment = target / speed;

      if (count < target) {
        counter.innerText = Math.ceil(count + increment);
        setTimeout(animateNumbers, 1);
      } else {
        counter.innerText = target;
      }
    });
  };

  // Trigger animazioni quando visibili
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate');
        if (entry.target.id === 'hero') {
          animateNumbers();
        }
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('section').forEach(section => {
    observer.observe(section);
  });
});
