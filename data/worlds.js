/* Worlds: static config for the "Explore Marcato" destination cards on the homepage.
 *
 * A "world" is a specialized Marcato shopping experience (Food, Fashion, Beauty, Home, Gifts) —
 * distinct from categories, brands and vendors. There is no database table for these yet: the set
 * is fixed for this first version, so it lives here the same way a nav menu would.
 *
 * Each world opens at #world=slug (see components/world-page.js), which for now shows a lightweight
 * "coming soon" placeholder. The slug is the future route for the dedicated world page.
 *
 *   Worlds.list()          -> [{ slug, name, tagline, gradient, icon }, ...]
 *   Worlds.bySlug(slug)    -> single world or null
 */
(function (global) {
  'use strict';

  var LIST = [
    {
      slug: 'food',
      name: 'Food',
      tagline: 'Restaurants, meals & treats',
      gradient: 'linear-gradient(155deg,#FF7A3D 0%,#D91C2D 100%)',
      icon: '<path d="M18 3c-2 0-4 1.5-4 4.5 0 2 1 3 1 4.5 0 3-2 5-2 8.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M6 3v6a2 2 0 002 2 2 2 0 002-2V3M8 11v9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>'
    },
    {
      slug: 'fashion',
      name: 'Fashion',
      tagline: 'Style for women, men & kids',
      gradient: 'linear-gradient(155deg,#4B4358 0%,#1B1625 100%)',
      icon: '<path d="M9 4l3 2 3-2 4 3-2.5 2.5L18 12v8H6v-8l1.5-2.5L5 7l4-3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>'
    },
    {
      slug: 'beauty',
      name: 'Beauty',
      tagline: 'Hair, makeup & skincare',
      gradient: 'linear-gradient(155deg,#FF7FB0 0%,#B4227A 100%)',
      icon: '<path d="M12 3v4M9 5.5l1.5 3M15 5.5L13.5 8.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M8 10c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 3.5-4 3.5-4-1.3-4-3.5z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 13.5V21M8.5 21h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
    },
    {
      slug: 'home',
      name: 'Home',
      tagline: 'Everything for your home',
      gradient: 'linear-gradient(155deg,#2FB8A3 0%,#0E4F4B 100%)',
      icon: '<path d="M4 11.5L12 4l8 7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M6 10v9h12v-9" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/><path d="M10 19v-5h4v5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>'
    },
    {
      slug: 'gifts',
      name: 'Gifts',
      tagline: 'Find something worth giving',
      gradient: 'linear-gradient(155deg,#8B6BE0 0%,#3F2E8C 100%)',
      icon: '<path d="M4 9h16v4H4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/><path d="M5 13h14v8H5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/><path d="M12 9v12M12 9c-1.2-3-3-4.5-4.5-4.2C6 5.1 6 7.3 7.5 8.2 9 9 12 9 12 9zm0 0c1.2-3 3-4.5 4.5-4.2C18 5.1 18 7.3 16.5 8.2 15 9 12 9 12 9z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>'
    }
  ];

  var BY_SLUG = {};
  LIST.forEach(function (w) { BY_SLUG[w.slug] = w; });

  (global.Worlds = global.Worlds || {});
  global.Worlds.list = function () { return LIST.slice(); };
  global.Worlds.bySlug = function (slug) { return BY_SLUG[slug] || null; };
})(window);
