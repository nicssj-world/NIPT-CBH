-- Owner Lock OD-R1 / OD-R1a (2026-10-17): a redraw S2 received via HIS PET reuses the S1 LN Halos base and its tube
-- labels print BASE[D]R (Twins: D before R). The print audit row must record the code actually printed.
-- Approved scope (Plan Rev 3.4 §11B, Migration 099): this CHECK only. The new pattern is a superset of the old one,
-- so every existing row stays valid; no data is changed and no other table, trigger, sequence or issuer is touched.
ALTER TABLE label_print_item DROP CONSTRAINT label_print_item_printed_code_check;
ALTER TABLE label_print_item ADD CONSTRAINT label_print_item_printed_code_check CHECK(printed_code ~ '^[0-9]{2}B[0-9]{9}D?R?$');
