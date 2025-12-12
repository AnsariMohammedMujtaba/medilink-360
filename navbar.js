function initNavbar() {
  // --- Mobile Menu Toggle ---
  const menuButton = document.getElementById("mobile-menu-button");
  const mobileMenu = document.getElementById("mobile-menu");
  const iconOpen = document.getElementById("icon-open");
  const iconClose = document.getElementById("icon-close");

  if (menuButton) {
    menuButton.addEventListener("click", () => {
      const isExpanded = menuButton.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", !isExpanded);
      mobileMenu.classList.toggle("hidden");
      iconOpen.classList.toggle("hidden");
      iconClose.classList.toggle("hidden");
    });
  }

  // --- Drug Types Dropdown Toggle ---
  const drugTypesButton = document.getElementById("drug-types-button");
  const drugTypesMenu = document.getElementById("drug-types-menu");

  if (drugTypesButton) {
    drugTypesButton.addEventListener("click", () => {
      const isExpanded = drugTypesButton.getAttribute("aria-expanded") === "true";
      drugTypesButton.setAttribute("aria-expanded", !isExpanded);
      
      // Toggle the 'hidden' class to show/hide the menu
      drugTypesMenu.classList.toggle("hidden");
    });
  }

  // Hide dropdown when clicking elsewhere
  document.addEventListener("click", (e) => {
    if (
      drugTypesButton &&
      drugTypesMenu &&
      !drugTypesButton.contains(e.target) &&
      !drugTypesMenu.contains(e.target)
    ) {
      drugTypesButton.setAttribute("aria-expanded", "false");
      
      // Add the 'hidden' class to hide the menu
      drugTypesMenu.classList.add("hidden");
    }
  });
}