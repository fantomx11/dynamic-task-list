// infoModalHandler.js

document.addEventListener('DOMContentLoaded', () => {
    // 1. Dynamic Info Modal Creation
    const infoModal = document.createElement('dialog');
    infoModal.id = 'infoModal';
    infoModal.classList.add('modal');

    const modalContentDiv = document.createElement('div');
    modalContentDiv.classList.add('modal-content');

    const closeButton = document.createElement('button'); // Ensure this 'closeButton' variable is correctly defined
    closeButton.classList.add('close-button');
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.innerHTML = '&times;'; // HTML entity for 'x'

    const infoModalHeading = document.createElement('h2');
    infoModalHeading.id = 'infoModalHeading';

    const infoModalText = document.createElement('div');
    infoModalText.id = 'infoModalText';

    modalContentDiv.appendChild(closeButton); // Make sure the closeButton is appended to the content div
    modalContentDiv.appendChild(infoModalHeading);
    modalContentDiv.appendChild(infoModalText);
    infoModal.appendChild(modalContentDiv);

    document.body.appendChild(infoModal);

    // Function to show the info modal with given heading and text
    function showInfoModal(heading, text) {
        infoModalHeading.textContent = heading;
        infoModalText.innerHTML = text;
        infoModal.showModal();
    }

    // 2. Dynamic Help Icon Creation
    const helpIcon = document.createElement('div');
    helpIcon.id = 'helpIcon';
    helpIcon.title = 'Click for help';
    helpIcon.textContent = '?';
    document.body.appendChild(helpIcon);

    // 3. Dynamic Help Menu Creation
    const helpMenu = document.createElement('ul');
    helpMenu.id = 'helpMenu';
    document.body.appendChild(helpMenu);

    // Determine if the current page is the main page (index.html)
    const currentPagePath = window.location.pathname.toLowerCase();
    const isMainPage = currentPagePath === '/' || currentPagePath.endsWith('/index.html');

    // Conditionally add the "Main Page" link
    if (!isMainPage) {
        const homePageLink = document.createElement('a');
        homePageLink.href = 'index.html';
        homePageLink.textContent = 'Main Page';
        homePageLink.target = "_top";

        const li1 = document.createElement('li');
        li1.appendChild(homePageLink);
        helpMenu.appendChild(li1);

        // Add the horizontal rule only if the "Main Page" link is present
        const hr = document.createElement('hr');
        helpMenu.appendChild(hr);
    }

    const aboutPageButton = document.createElement('button');
    aboutPageButton.textContent = 'About this Page';
    aboutPageButton.type = 'button';

    const li2 = document.createElement('li');
    li2.appendChild(aboutPageButton);
    helpMenu.appendChild(li2);


    /* This conflicts with including info tags in the body element. if this gets reimplemented, that needs to change.

    // 4. Event listeners for data-info-heading triggers
    const infoTriggers = document.querySelectorAll('[data-info-heading]');

    infoTriggers.forEach(trigger => {
        trigger.style.cursor = 'pointer';
        // trigger.style.textDecoration = 'underline'; // Uncomment if you want the underline

        trigger.addEventListener('click', (event) => {
            if (trigger.tagName === 'A' && trigger.hasAttribute('href')) {
                event.preventDefault();
            }
            showInfoModal(trigger.dataset.infoHeading, trigger.dataset.infoText);
        });
    });
    */

    // 5. Event listener for the Help Icon (toggles the new menu)
    helpIcon.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent this click from immediately closing the menu via body listener
        helpMenu.classList.toggle('active');
    });

    // 6. Event listener for "About this page" button in the menu
    aboutPageButton.addEventListener('click', () => {
        const bodyElement = document.body;
        const pageHeading = bodyElement.dataset.infoHeading || "Information About This Page";
        const pageText = bodyElement.dataset.infoText || "No specific information provided for this page. Add data-info-heading and data-info-text attributes to the body tag.";
        
        showInfoModal(pageHeading, pageText);
        helpMenu.classList.remove('active'); // Close the menu after opening the modal
    });

    // 7. Close Help Menu when clicking outside of it
    document.addEventListener('click', (event) => {
        if (helpMenu.classList.contains('active') && !helpIcon.contains(event.target) && !helpMenu.contains(event.target)) {
            helpMenu.classList.remove('active');
        }
    });

    // 8. Close Info Modal functionality
    // THIS IS THE KEY PART FOR CLOSING THE MODAL WITH THE BUTTON
    closeButton.addEventListener('click', () => {
        infoModal.close(); // Ensures the dialog element's close() method is called
    });

    // Optional: Close the modal if clicked outside (on the backdrop)
    infoModal.addEventListener('click', (event) => {
        // This specifically targets clicks on the backdrop, not elements inside the modal content
        if (event.target === infoModal) {
            infoModal.close();
        }
    });
});