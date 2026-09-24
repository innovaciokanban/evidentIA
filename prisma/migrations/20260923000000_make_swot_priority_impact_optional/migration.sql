-- Make SWOT factor priority and impact optional.
-- Non-destructive: existing rows keep their historical values; new factors no longer require them.
-- Priority and impact remain reserved for strategies/actions (ActionItem, Recommendation, StrategicCross).

ALTER TABLE "SWOTItem" ALTER COLUMN "priority" DROP NOT NULL;
ALTER TABLE "SWOTItem" ALTER COLUMN "impact" DROP NOT NULL;