/* Buyer data layer: saved profile, address book and order counts.
 * Everything here uses the signed-in buyer's own session; row-level security keeps each person to their own rows.
 * Guests keep their delivery details on this device only (localStorage), so they are not asked twice either.
 */
(function (global) {
  'use strict';

  var GUEST_KEY = 'mct_delivery_v1';

  function clean(v) { return v == null ? '' : String(v).trim(); }

  /* delivery object used by /api/checkout */
  function complete(d) { return !!(d && clean(d.name) && clean(d.phone) && clean(d.line1) && clean(d.email)); }

  function fromSaved(profile, address, email) {
    var a = address || {};
    return {
      name: clean(a.full_name) || clean(profile && profile.full_name),
      phone: clean(a.phone) || clean(profile && profile.phone),
      email: clean(email),
      line1: clean(a.line1), city: clean(a.city), state: clean(a.state),
      lat: a.lat == null ? null : Number(a.lat), lng: a.lng == null ? null : Number(a.lng),
      display_name: clean(a.display_name), address_id: a.id || null
    };
  }

  function guest() {
    try { return JSON.parse(localStorage.getItem(GUEST_KEY)) || null; } catch (_) { return null; }
  }
  function saveGuest(d) {
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(d)); } catch (_) { /* private mode */ }
  }
  function forgetGuest() { try { localStorage.removeItem(GUEST_KEY); } catch (_) {} }

  async function profile(sb, uid) {
    var r = await sb.from('profiles').select('*').eq('user_id', uid).maybeSingle();
    return r.error ? null : r.data;
  }
  async function saveProfile(sb, uid, patch) {
    var row = Object.assign({ user_id: uid, updated_at: new Date().toISOString() }, patch);
    var r = await sb.from('profiles').upsert([row], { onConflict: 'user_id' }).select().maybeSingle();
    if (r.error) throw r.error;
    return r.data;
  }

  async function addresses(sb, uid) {
    var r = await sb.from('addresses').select('*').eq('user_id', uid).order('is_default', { ascending: false }).order('created_at', { ascending: false });
    return r.error ? [] : (r.data || []);
  }

  /* insert or update; making one the default clears the flag on the others first (only one default per person) */
  async function saveAddress(sb, uid, a) {
    var row = {
      user_id: uid, label: clean(a.label) || 'Home', full_name: clean(a.full_name), phone: clean(a.phone),
      line1: clean(a.line1), city: clean(a.city), state: clean(a.state), country: clean(a.country) || 'Nigeria',
      lat: a.lat == null || a.lat === '' ? null : Number(a.lat), lng: a.lng == null || a.lng === '' ? null : Number(a.lng),
      display_name: clean(a.display_name), is_default: !!a.is_default
    };
    if (!row.line1) throw new Error('Enter the street address');
    if (row.is_default) await sb.from('addresses').update({ is_default: false }).eq('user_id', uid).neq('id', a.id || 0);
    var q = a.id ? sb.from('addresses').update(row).eq('id', a.id).eq('user_id', uid) : sb.from('addresses').insert([row]);
    var r = await q.select().maybeSingle();
    if (r.error) throw r.error;
    return r.data;
  }
  async function deleteAddress(sb, uid, id) {
    var r = await sb.from('addresses').delete().eq('id', id).eq('user_id', uid);
    if (r.error) throw r.error;
  }
  async function setDefault(sb, uid, id) {
    await sb.from('addresses').update({ is_default: false }).eq('user_id', uid);
    var r = await sb.from('addresses').update({ is_default: true }).eq('id', id).eq('user_id', uid);
    if (r.error) throw r.error;
  }

  /* my orders, bucketed like the profile page's status row. Orders from before online payment (no payment reference)
   * are grouped by their order status only, so old orders never show up as "unpaid". */
  function bucket(o) {
    var legacy = !o.payment_reference;
    var fs = o.fulfillment_status || '';
    if (!legacy && ['pending', 'failed'].indexOf(o.payment_status) !== -1 && fs !== 'cancelled') return 'topay';
    if (['refunded', 'partially_refunded'].indexOf(o.payment_status) !== -1) return 'refunds';
    if (['shipped', 'in_transit', 'out_for_delivery', 'partially_shipped'].indexOf(fs) !== -1) return 'shipped';
    if (['delivered', 'partially_delivered'].indexOf(fs) !== -1) return 'delivered';
    if (fs === 'cancelled') return 'cancelled';
    return 'processing';
  }
  async function orderCounts(sb, uid) {
    var r = await sb.from('orders').select('id,status,payment_status,payment_reference').eq('user_id', uid);
    var c = { topay: 0, processing: 0, shipped: 0, delivered: 0, refunds: 0 };
    (r.data || []).forEach(function (o) { var b = bucket(o); if (c[b] != null) c[b]++; });
    return c;
  }

  async function counts(sb, uid) {
    var fav = await sb.from('favorites').select('product_id', { count: 'exact', head: true }).eq('user_id', uid);
    var cou = await sb.from('user_coupons').select('id', { count: 'exact', head: true }).eq('user_id', uid).is('used_at', null);
    return { wishlist: fav.count || 0, coupons: cou.count || 0 };
  }

  global.Buyer = {
    complete: complete, fromSaved: fromSaved, guest: guest, saveGuest: saveGuest, forgetGuest: forgetGuest,
    profile: profile, saveProfile: saveProfile, addresses: addresses, saveAddress: saveAddress, deleteAddress: deleteAddress,
    setDefault: setDefault, bucket: bucket, orderCounts: orderCounts, counts: counts
  };
})(window);
