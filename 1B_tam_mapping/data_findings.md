# 1B · What is wrong in the companies and contacts base (Attio, 2026-09-25)

Volumes: 5,080 companies and 14,680 contacts. Sized with [`exploration/checks_accounts.py`](exploration/checks_accounts.py) before the account model was built; [`tam_dedup.py`](tam_dedup.py) then turns them into work queues (see [`tam_mapping.md`](tam_mapping.md)).

## Identity keys
- SIRET: 761 values with 9 digits (SIREN typed in the SIRET field; 756 of them on French accounts, the figure used in the write-up), 14 values with 17 characters or non-digits, 15 others of invalid length: about 790 invalid values (16%), plus 10% empty.
- 181 SIRET-field values shared by 378 rows. Sharing a 9-digit SIREN is normal (several sites, one legal entity). Of the 148 shared 14-digit SIRETs (309 rows), 81 sit in a single postcode: likely duplicates; the others span several postcodes, so one of the numbers was probably copied onto the wrong account. `tam_dedup.py` merges only the first kind and sends the second to review.
- 178 normalised name + postcode keys over 362 rows: likely duplicates.
- Domains: 233 rows share 96 domains. Practice "domains" include doctolib.fr (15), maiia.com (14), wanadoo.fr (12), pagesjaunes.fr (10) and gmail.com (5): junk values.
- Switchboard phone shared by 138 rows, calendar URL by 155, LinkedIn by 107. Phones come in at least 5 formats.

## Hierarchy
- 3 records are their own parent.
- Inconsistent types: 12 Practices under a Practice (3 of them are their own parent), 5 Groups under a Practice, 65 rows without `type`. 19 Groups sit under a Group: valid, they are sub-groups of a larger one.
- 112 Groups without any child practice, 76 with a single child.
- `practice_count` does not match the number of children in the CRM for 233 of 329 Groups.
- 53 rows typed Practice have `practice_count` above 1: mistyped groups.
- 572 children have a different `sales_owner` from their parent.

## Untrustworthy fields
- `lifecycle` empty on 334 rows. A Hyperline ID sits on 204 non-customers (99 Prospects, 37 Leads). 188 Customers have no ARR and 210 no billing ID. 70 rows have a `customer_lifecycle` without being Customers.
- 16 Closed Won deals sit on a company that is neither Customer nor Churn. Conversely, 406 Customers have no won deal in the export (possibly signed before 2025, to be checked).
- `country` contains "France", "fr", "Libourne", "Saint-Jean" and 118 blanks. 55 non-French rows have a French `area`.
- Specialties: 37 distinct values with synonyms (Surgery / Chirurgy, Physical Therapist / Kinesitherapy, Radiology / Imaging).
- Owners: 177 accounts owned by people who left, 16 with an SDR as `sales_owner`, 21 with an `am_owner` missing from `sales_team`.

## Contacts
- 450 contacts without a company. 2,439 contacts attached to a Group or Superorga rather than to the practice.
- 284 duplicates on first name + last name + company. 134 RPPS numbers appear on 268 rows.
- An RPPS sits on 924 Administrative contacts although RPPS is for practitioners only; 2,118 Practitioners have none.
- 279 contacts have a work email whose domain belongs to another account (first pass: a contact on a site whose domain belongs to the site's own group was still counted). `tam_dedup.py` refines it: 160 are on the wrong account family; for 47 other sites the contacts use their network's domain, so it is the site that is missing its parent link.
- 652 emails on webmail domains; 22 emails shared by several contacts.
- 1,465 companies have no contact. 69% of contacts come from the enrichment pipeline and 74% of contacts have no email.

## Limits of the anonymisation
Names and towns were reshuffled during anonymisation, so person-name matches across companies (3,625) are not usable and are not reported as a finding.
