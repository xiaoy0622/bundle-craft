(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    const buttons = document.querySelectorAll(".bundlecraft-add-to-cart");

    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        const variantId = button.getAttribute("data-variant-id");
        if (!variantId) return;

        // Set loading state
        button.disabled = true;
        button.classList.add("bundlecraft-add-to-cart--loading");
        const originalText = button.textContent;

        // Add to cart via Shopify AJAX API
        fetch("/cart/add.js", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: [
              {
                id: variantId.replace("gid://shopify/ProductVariant/", ""),
                quantity: 1,
              },
            ],
          }),
        })
          .then(function (response) {
            if (!response.ok) {
              throw new Error("Failed to add to cart");
            }
            return response.json();
          })
          .then(function () {
            // Success feedback
            button.textContent = "Added to Cart ✓";
            button.classList.remove("bundlecraft-add-to-cart--loading");

            // Reset button after delay
            setTimeout(function () {
              button.textContent = originalText;
              button.disabled = false;
            }, 2000);

            // Trigger cart update event for theme integration
            document.dispatchEvent(new CustomEvent("cart:updated"));
          })
          .catch(function (error) {
            console.error("BundleCraft: Failed to add to cart", error);
            button.textContent = "Error - Try Again";
            button.classList.remove("bundlecraft-add-to-cart--loading");
            button.disabled = false;

            setTimeout(function () {
              button.textContent = originalText;
            }, 3000);
          });
      });
    });
  });
})();
