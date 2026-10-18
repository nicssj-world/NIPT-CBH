-- REHEARSAL ONLY: a migration that fails, to prove a failed upgrade leaves the old release running.
SELECT 1 FROM p8_rehearsal_table_that_does_not_exist;
