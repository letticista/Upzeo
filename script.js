// JavaScript for theme toggle
document.querySelector('.theme-toggle').addEventListener('click', function () {
    const body = document.body;
    if (body.getAttribute('data-theme') === 'dark') {
        body.setAttribute('data-theme', 'light');
    } else {
        body.setAttribute('data-theme', 'dark');
    }
});

// JavaScript for smooth scroll to section
document.querySelectorAll('.nav-link').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        window.scrollTo({
            top: target.offsetTop - 50,
            behavior: 'smooth'
        });
    });
});

// Form submission handling
document.querySelector('#contact-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const formData = new FormData(this);
    const formObject = Object.fromEntries(formData.entries());

    console.log('Form Data Submitted:', formObject);

    // Example of a simple alert message after form submission
    alert('Grazie per averci contattato! Ti risponderemo al più presto.');
    this.reset(); // Reset form after submission
});
