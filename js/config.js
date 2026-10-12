// Settings for whoever publishes GeoNote (the same for every phone that opens the app).
// Edit this file on GitHub; phones pick up the change the next time they open the app online.
// Keep your keys when you upload a new version of GeoNote: do not upload config.js over this one.

// ---------- Satellite view ----------
// The first one that is set is used. With neither key, the app shows Sentinel-2 cloudless by EOX:
// free for non-commercial use, no sign-up, but only 10 m pixels.
//
// Google satellite (Map Tiles API): needs a Google Cloud project with billing turned on. 100,000
// tiles a month are free; set a daily quota so you are never charged (see README). Restrict the
// key to your GitHub Pages address and to the Map Tiles API.
export const GOOGLE_MAPS_API_KEY = '';

// Esri World Imagery (ArcGIS Location Platform): free account, "Static basemap tiles" privilege,
// restrict the key to your GitHub Pages address. Without pay-as-you-go it stops at the free tier
// instead of charging.
export const ARCGIS_API_KEY = 'AAPTaIuFQbvwkIvXhWn_NFM6dZg..1J8UmofbLVgOFxgBmzZAheadShs2iVn1qj3SYNOQbdLUKP-DvAnTHfU4sLH8xdyWs-_YSAcRcpwiIO0rciNUWxdqAFUBP6h63QJuYM7jqo5TZi7J2keIFw38wTinU6BqohRSqZxmjgRXBQ52uW64ZW5GfpHkV1OShBKSXSt0XAnUn8AS31iJJvHtBN6QXe2aLyn2I9g3fHE_u3MNqKTpxBriP9MQSAtds_d8YSwb20Bz5dk_dw3mfMwuv7nMYw..AT1_gMAqu5zR';
