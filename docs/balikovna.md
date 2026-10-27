# Balíkovna checkout integration

Customer rates approved by the merchant: pickup 0 CZK, Balíkovna outlet 89 CZK, home delivery in CZ 119 CZK. One outgoing delivery fee per reservation; return shipping is agreed separately. Pickup: Kytlická 682/2.

The server stores shippingPrice as an immutable reservation snapshot. subtotal includes rental minus any fitting discount plus shipping; totalDue adds the refundable deposit. Invoice lines separate rental and shipping. Existing payment ledger/QR amounts use the inclusive subtotal. Existing reservations are not repriced.

New checkout sends deliveryTariff=2026-10. The server always computes the delivery fee from the chosen method, never from a client amount. Home delivery requires the marker. Deploy backend first, then frontend; existing open tabs should be refreshed after the release.

The official location picker runs in a modal iframe with type=BALIKOVNY. Validate message origin and iframe source; persist provider point id, name, address, and ZIP separately. Never derive a posting ZIP from the street address. Recipient email and phone come from the reservation contact. Address delivery is limited to CZ and requires street/house, city and five-digit postcode.

Reviewed supplied implementation package dated 21 June 2024: picker manual, cart display manual, product sheets and label instructions. Branded SVG assets are from its cart logo directory. Current provider documentation also separates pickup selection from nAPI parcel posting:
https://www.balikovna.cz/cs/ke-stazeni
https://www.ceskaposta.cz/documents/d/guest/napi-nejcastejsi_dotazy_a_vyskytujici_se_chyby-pdf-2

This release does not create a parcel, buy postage, request pickup or produce carrier labels. nAPI needs the merchant contract, B2B API credentials, authorized product/customer/posting identifiers and a configured posting location. None were supplied. Do not fabricate labels from the sample templates. Posting and return arrangements remain manual until that connection is configured and tested. Admins must account for outward/return transit when confirming inventory availability; the calendar still represents rental dates plus existing cleaning rules.
