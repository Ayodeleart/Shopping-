/* Practical Nigerian state/LGA options used by checkout and the address book.
 * Areas are suggestions only: the town/area field remains free text so no customer is blocked.
 */
(function (global) {
  'use strict';
  var states = {
    Abuja: ['Abaji', 'Bwari', 'Gwagwalada', 'Kuje', 'Municipal Area Council', 'Kwali', 'Abuja Municipal Area Council'],
    Abia: ['Aba North', 'Aba South', 'Arochukwu', 'Ikwuano', 'Isiala Ngwa North', 'Isiala Ngwa South', 'Obi Ngwa', 'Ohafia', 'Osisioma Ngwa', 'Umuahia North', 'Umuahia South', 'Ukwa East', 'Ukwa West'],
    Adamawa: ['Demsa', 'Fufore', 'Ganye', 'Girei', 'Gombi', 'Guyuk', 'Hong', 'Jada', 'Jimeta', 'Mayo-Belwa', 'Mubi North', 'Mubi South', 'Numan', 'Song', 'Yola North', 'Yola South'],
    'Akwa Ibom': ['Abak', 'Eastern Obolo', 'Eket', 'Esit Eket', 'Etinan', 'Ikot Ekpene', 'Ibeno', 'Ini', 'Ibiono Ibom', 'Itu', 'Oron', 'Uyo'],
    Anambra: ['Aguata', 'Awka North', 'Awka South', 'Anambra East', 'Anambra West', 'Dunukofia', 'Idemili North', 'Idemili South', 'Ihiala', 'Nnewi North', 'Nnewi South', 'Onitsha North', 'Onitsha South', 'Ogbaru', 'Oyi'],
    Bauchi: ['Bauchi', 'Bogoro', 'Dass', 'Darazo', 'Ganjuwa', 'Jama’are', 'Katagum', 'Kirfi', 'Misau', 'Ningi', 'Toro', 'Warji'],
    Bayelsa: ['Brass', 'Ekeremor', 'Kolokuma/Opokuma', 'Nembe', 'Ogbia', 'Sagbama', 'Southern Ijaw', 'Yenagoa'],
    Benue: ['Ado', 'Agatu', 'Apa', 'Buruku', 'Gboko', 'Guma', 'Gwer East', 'Gwer West', 'Katsina-Ala', 'Konshisha', 'Makurdi', 'Otukpo', 'Tarka', 'Ushongo', 'Vandeikya'],
    Borno: ['Askira/Uba', 'Bama', 'Biu', 'Damboa', 'Dikwa', 'Gubio', 'Jere', 'Kaga', 'Konduga', 'Maiduguri', 'Monguno', 'Ngala'],
    'Cross River': ['Abi', 'Akamkpa', 'Akpabuyo', 'Bakassi', 'Calabar Municipal', 'Calabar South', 'Ikom', 'Obanliku', 'Obubra', 'Ogoja', 'Yakurr'],
    Delta: ['Aniocha North', 'Aniocha South', 'Bomadi', 'Burutu', 'Ethiope East', 'Ethiope West', 'Ika North East', 'Ika South', 'Isoko North', 'Isoko South', 'Okpe', 'Oshimili North', 'Oshimili South', 'Sapele', 'Uvwie', 'Warri South'],
    Ebonyi: ['Abakaliki', 'Afikpo North', 'Afikpo South', 'Ebonyi', 'Ezza North', 'Ezza South', 'Ikwo', 'Ishielu', 'Ivo', 'Izzi', 'Ohaukwu', 'Onicha'],
    Edo: ['Akoko-Edo', 'Egor', 'Esan Central', 'Esan North-East', 'Esan South-East', 'Esan West', 'Igueben', 'Ikpoba-Okha', 'Oredo', 'Ovia North-East', 'Ovia South-West', 'Uhunmwonde'],
    Ekiti: ['Ado Ekiti', 'Efon', 'Ekiti East', 'Ekiti South-West', 'Ekiti West', 'Emure', 'Gbonyin', 'Ido-Osi', 'Ijero', 'Ikere', 'Ikole', 'Irepodun/Ifelodun', 'Ise/Orun', 'Moba', 'Oye'],
    Enugu: ['Aninri', 'Awgu', 'Enugu East', 'Enugu North', 'Enugu South', 'Ezeagu', 'Igbo-Etiti', 'Igboeze North', 'Igboeze South', 'Nsukka', 'Nkanu East', 'Nkanu West', 'Oji River', 'Udenu', 'Udi'],
    Gombe: ['Akko', 'Balanga', 'Billiri', 'Dukku', 'Gombe', 'Kaltungo', 'Kwami', 'Nafada', 'Shongom', 'Yamaltu-Deba'],
    Imo: ['Ehime Mbano', 'Ezinihitte', 'Ideato North', 'Ideato South', 'Ihitte/Uboma', 'Ikeduru', 'Isu', 'Mbaitoli', 'Ngor Okpala', 'Nkwerre', 'Obowo', 'Ohaji/Egbema', 'Okigwe', 'Owerri Municipal', 'Owerri North', 'Owerri West'],
    Jigawa: ['Auyo', 'Birnin Kudu', 'Birniwa', 'Dutse', 'Gumel', 'Hadejia', 'Jahun', 'Kazaure', 'Kiri Kasama', 'Maigatari', 'Ringim', 'Wurno'],
    Kaduna: ['Birnin Gwari', 'Chikun', 'Giwa', 'Igabi', 'Ikara', 'Jema’a', 'Kaduna North', 'Kaduna South', 'Kachia', 'Kagarko', 'Kajuru', 'Kudan', 'Sabon Gari', 'Zaria'],
    Kano: ['Ajingi', 'Albasu', 'Bichi', 'Dala', 'Dambatta', 'Dawakin Kudu', 'Fagge', 'Garun Mallam', 'Gwale', 'Kano Municipal', 'Kazaure', 'Kibiya', 'Kiru', 'Nasarawa', 'Tarauni', 'Ungogo', 'Wudil'],
    Katsina: ['Batagarawa', 'Batsari', 'Baure', 'Bindawa', 'Charanchi', 'Dandume', 'Dan Musa', 'Faskari', 'Funtua', 'Jibiya', 'Kafur', 'Kaita', 'Katsina', 'Mani', 'Rimi', 'Safana'],
    Kebbi: ['Aleiro', 'Arewa Dandi', 'Argungu', 'Birnin Kebbi', 'Bunza', 'Dandi', 'Gwandu', 'Jega', 'Kalgo', 'Kebbe', 'Maiyama', 'Ngaski', 'Sakaba', 'Zuru'],
    Kogi: ['Adavi', 'Ajaokuta', 'Ankpa', 'Dekina', 'Idah', 'Ijumu', 'Kabba/Bunu', 'Kogi', 'Lokoja', 'Ofu', 'Okene', 'Olamaboro', 'Omala', 'Yagba East', 'Yagba West'],
    Kwara: ['Asa', 'Baruten', 'Edu', 'Ekiti', 'Ilorin East', 'Ilorin South', 'Ilorin West', 'Ifelodun', 'Isin', 'Kaiama', 'Moro', 'Offa', 'Oke Ero', 'Oyun', 'Pategi'],
    Lagos: ['Agege', 'Ajeromi-Ifelodun', 'Alimosho', 'Amuwo-Odofin', 'Apapa', 'Badagry', 'Epe', 'Eti-Osa', 'Ibeju-Lekki', 'Ikeja', 'Ikorodu', 'Kosofe', 'Lagos Island', 'Lagos Mainland', 'Mushin', 'Ojo', 'Oshodi-Isolo', 'Somolu', 'Surulere'],
    Nasarawa: ['Akwanga', 'Awe', 'Doma', 'Karu', 'Keana', 'Keffi', 'Kokona', 'Lafia', 'Nasarawa', 'Nasarawa Eggon', 'Obi', 'Toto', 'Wamba'],
    Niger: ['Agaie', 'Bida', 'Borgu', 'Chanchaga', 'Edati', 'Gbako', 'Gurara', 'Katcha', 'Kontagora', 'Lapai', 'Lavun', 'Minna', 'Mokwa', 'Munya', 'Paikoro', 'Shiroro', 'Suleja', 'Tafa'],
    Ogun: ['Abeokuta North', 'Abeokuta South', 'Ado-Odo/Ota', 'Ayetoro', 'Ewekoro', 'Ifo', 'Ijebu East', 'Ijebu North', 'Ijebu Ode', 'Ikenne', 'Imeko Afon', 'Ipokia', 'Obafemi Owode', 'Odeda', 'Odogbolu', 'Remo North', 'Sagamu', 'Yewa North', 'Yewa South'],
    Ondo: ['Akoko North-East', 'Akoko North-West', 'Akoko South-East', 'Akoko South-West', 'Akure North', 'Akure South', 'Ese Odo', 'Idanre', 'Ilaje', 'Ile Oluji/Okeigbo', 'Irele', 'Odigbo', 'Ondo East', 'Ondo West', 'Owo'],
    Osun: ['Atakunmosa East', 'Atakunmosa West', 'Ayedaade', 'Ayedire', 'Boripe', 'Ede North', 'Ede South', 'Egbedore', 'Ejigbo', 'Ife Central', 'Ife East', 'Ife North', 'Ife South', 'Ila', 'Ilesa East', 'Ilesa West', 'Irepodun', 'Osogbo'],
    Oyo: ['Akinyele', 'Atiba', 'Atisbo', 'Egbeda', 'Ibadan North', 'Ibadan North-East', 'Ibadan North-West', 'Ibadan South-East', 'Ibadan South-West', 'Ibarapa Central', 'Ibarapa East', 'Ibarapa North', 'Ido', 'Lagelu', 'Ogbomoso North', 'Ogbomoso South', 'Oluyole', 'Oyo East', 'Oyo West'],
    Plateau: ['Barkin Ladi', 'Bassa', 'Jos East', 'Jos North', 'Jos South', 'Jos West', 'Kanke', 'Langtang North', 'Langtang South', 'Mangu', 'Pankshin', 'Riyom', 'Shendam', 'Wase'],
    Rivers: ['Abua/Odual', 'Ahoada East', 'Ahoada West', 'Akuku-Toru', 'Andoni', 'Asari-Toru', 'Bonny', 'Degema', 'Eleme', 'Emohua', 'Etche', 'Gokana', 'Ikwerre', 'Khana', 'Obio/Akpor', 'Okrika', 'Omuma', 'Oyigbo', 'Port Harcourt', 'Tai'],
    Sokoto: ['Binji', 'Bodinga', 'Dange Shuni', 'Gada', 'Goronyo', 'Gudu', 'Illela', 'Kebbe', 'Kware', 'Rabah', 'Sabon Birni', 'Sokoto North', 'Sokoto South', 'Tambuwal', 'Wamakko', 'Wurno'],
    Taraba: ['Ardo-Kola', 'Bali', 'Donga', 'Gassol', 'Jalingo', 'Karim Lamido', 'Lau', 'Sardauna', 'Takum', 'Wukari', 'Yorro', 'Zing'],
    Yobe: ['Bade', 'Bursari', 'Damaturu', 'Fika', 'Fune', 'Geidam', 'Gujba', 'Gulani', 'Jakusko', 'Karasuwa', 'Machina', 'Nguru', 'Potiskum', 'Tarmuwa', 'Yunusari'],
    Zamfara: ['Anka', 'Bakura', 'Birnin Magaji/Kiyaw', 'Bukkuyum', 'Bungudu', 'Chafe', 'Gummi', 'Gusau', 'Kaura Namoda', 'Maradun', 'Maru', 'Shinkafi', 'Talata Mafara', 'Tsafe', 'Zurmi']
  };
  /* Remove the accidental placeholder if this file is edited or copied with a non-Latin keyboard. */
  states.Abuja = states.Abuja.filter(Boolean).filter(function (x) { return x !== 'कस'; });
  global.NigeriaAddress = { states: states, stateNames: Object.keys(states), lgas: function (state) { return states[state] || []; } };
})(window);
