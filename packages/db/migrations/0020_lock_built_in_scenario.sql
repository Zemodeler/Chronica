-- The built-in Numidian Decision is immutable during normal application use.
-- A future change must be an explicit, human-approved database operation that
-- sets chronica.scenario_mutation_approved to "yes" for its transaction.
CREATE OR REPLACE FUNCTION "public"."prevent_unapproved_built_in_scenario_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF (
		(TG_TABLE_NAME = 'scenarios' AND OLD.id = '00000000-0000-4000-8000-000000000101')
		OR (TG_TABLE_NAME = 'scenario_versions' AND OLD.scenario_id = '00000000-0000-4000-8000-000000000101')
		OR (TG_TABLE_NAME = 'scenario_map_assets' AND OLD.id = '00000000-0000-4000-8000-000000000201')
	) AND COALESCE(current_setting('chronica.scenario_mutation_approved', true), '') <> 'yes' THEN
		RAISE EXCEPTION 'The built-in scenario is locked. Set chronica.scenario_mutation_approved to yes only after explicit owner approval.'
			USING ERRCODE = '42501';
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER "scenarios_lock_built_in_scenario"
BEFORE UPDATE OR DELETE ON "scenarios"
FOR EACH ROW EXECUTE FUNCTION "public"."prevent_unapproved_built_in_scenario_mutation"();

CREATE TRIGGER "scenario_versions_lock_built_in_scenario"
BEFORE UPDATE OR DELETE ON "scenario_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."prevent_unapproved_built_in_scenario_mutation"();

CREATE TRIGGER "scenario_map_assets_lock_built_in_scenario"
BEFORE UPDATE OR DELETE ON "scenario_map_assets"
FOR EACH ROW EXECUTE FUNCTION "public"."prevent_unapproved_built_in_scenario_mutation"();
