# Buyer discovery and digital offers

All routes are authenticated and return FarmLink's standard response envelope.
Buyers manage only their own profile and demands; farmers and FPO admins can
only view matches for lots they are already authorized to manage. Public buyer
data intentionally excludes contact details, street addresses, and precise
coordinates.

Matching is deterministic. It considers crop, available quantity, compatible
grade, distance when both parties supply locations, target price when provided,
delivery-window overlap, and verification status. The response reports factors
used and omitted, score, confidence, reasons, and warnings rather than
inventing unavailable values.

`TradeOffer` is an auditable digital negotiation record, not a contract,
payment, logistics booking, escrow, or delivery completion. Counter offers add
an immutable revision. Offer acceptance is transactional and conditionally
decrements lot availability and demand capacity, preventing concurrent
overcommitment. The initiating party cannot accept its own offer, and only the
initiator can withdraw it.
