\pset tuples_only on
\pset format unaligned
\pset pager off
\o artifacts/stage-7c-inventory-before.json
WITH counts AS (
  SELECT 'AuditProgram' AS table_name, count(*)::int AS count FROM "AuditProgram"
  UNION ALL SELECT 'Audit', count(*)::int FROM "Audit"
  UNION ALL SELECT 'AuditPlan', count(*)::int FROM "AuditPlan"
  UNION ALL SELECT 'AuditPlanActivity', count(*)::int FROM "AuditPlanActivity"
  UNION ALL SELECT 'AuditPlanActivityAuditor', count(*)::int FROM "AuditPlanActivityAuditor"
  UNION ALL SELECT 'AuditTeamMember', count(*)::int FROM "AuditTeamMember"
  UNION ALL SELECT 'Auditor', count(*)::int FROM "Auditor"
  UNION ALL SELECT 'AuditChecklist', count(*)::int FROM "AuditChecklist"
  UNION ALL SELECT 'AuditChecklistItem', count(*)::int FROM "AuditChecklistItem"
  UNION ALL SELECT 'AuditFinding', count(*)::int FROM "AuditFinding"
  UNION ALL SELECT 'AuditEvidence', count(*)::int FROM "AuditEvidence"
  UNION ALL SELECT 'AuditEvidenceFile', count(*)::int FROM "AuditEvidenceFile"
  UNION ALL SELECT 'AuditCorrectiveAction', count(*)::int FROM "AuditCorrectiveAction"
  UNION ALL SELECT 'AuditEvent', count(*)::int FROM "AuditEvent"
), audit_row AS (
  SELECT a.*, p.id AS plan_id, p.status AS plan_status
  FROM "Audit" a
  LEFT JOIN "AuditPlan" p ON p."auditId" = a.id
  WHERE a.code = 'AUD-001'
)
SELECT jsonb_pretty(jsonb_build_object(
  'generatedAt', now(),
  'database', current_database(),
  'serverPort', inet_server_port(),
  'migration', '20261122000000_add_audit_activity_execution',
  'tableCounts', (SELECT jsonb_object_agg(table_name, count) FROM counts),
  'newTablePresence', jsonb_build_object(
    'AuditPlanActivityChecklistItem', to_regclass('public."AuditPlanActivityChecklistItem"') IS NOT NULL,
    'AuditPlanActivityEvidence', to_regclass('public."AuditPlanActivityEvidence"') IS NOT NULL,
    'AuditPlanActivityEvidenceFile', to_regclass('public."AuditPlanActivityEvidenceFile"') IS NOT NULL,
    'AuditPlanActivityFinding', to_regclass('public."AuditPlanActivityFinding"') IS NOT NULL
  ),
  'audit001', jsonb_build_object(
    'auditAndPlan', (SELECT to_jsonb(audit_row) FROM audit_row),
    'activities', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x."scheduledStart", x.position) FROM (
      SELECT id, "auditPlanId", position, type, title, description, "scheduledStart", "scheduledEnd", location,
             "responsibleId", "processId", status, notes
      FROM "AuditPlanActivity"
      WHERE "auditPlanId" = (SELECT plan_id FROM audit_row)
    ) x), '[]'::jsonb),
    'activityAuditors', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x."assignedAt") FROM (
      SELECT apa.*, at."auditId", at."companyId", at.role, at."isActive" AS team_member_active,
             at."independenceStatus", at."mitigationMeasures", au.name AS auditor_name, au.email AS auditor_email, au.type AS auditor_type
      FROM "AuditPlanActivityAuditor" apa
      JOIN "AuditPlanActivity" act ON act.id = apa."activityId"
      JOIN "AuditTeamMember" at ON at.id = apa."auditTeamMemberId"
      JOIN "Auditor" au ON au.id = at."auditorId"
      WHERE act."auditPlanId" = (SELECT plan_id FROM audit_row)
    ) x), '[]'::jsonb),
    'teamMembers', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x."assignedAt") FROM (
      SELECT at.*, au.name AS auditor_name, au.email AS auditor_email, au.type AS auditor_type
      FROM "AuditTeamMember" at
      JOIN "Auditor" au ON au.id = at."auditorId"
      WHERE at."auditId" = (SELECT id FROM audit_row)
    ) x), '[]'::jsonb),
    'resourceCounts', jsonb_build_object(
      'checklists', (SELECT count(*)::int FROM "AuditChecklist" WHERE "auditId" = (SELECT id FROM audit_row)),
      'checklistItems', (SELECT count(*)::int FROM "AuditChecklistItem" i JOIN "AuditChecklist" c ON c.id = i."checklistId" WHERE c."auditId" = (SELECT id FROM audit_row)),
      'findings', (SELECT count(*)::int FROM "AuditFinding" WHERE "auditId" = (SELECT id FROM audit_row)),
      'evidences', (SELECT count(*)::int FROM "AuditEvidence" WHERE "auditId" = (SELECT id FROM audit_row)),
      'evidenceFiles', (SELECT count(*)::int FROM "AuditEvidenceFile" WHERE "auditId" = (SELECT id FROM audit_row)),
      'correctiveActions', (SELECT count(*)::int FROM "AuditCorrectiveAction" f JOIN "AuditFinding" h ON h.id = f."findingId" WHERE h."auditId" = (SELECT id FROM audit_row)),
      'events', (SELECT count(*)::int FROM "AuditEvent" WHERE "auditId" = (SELECT id FROM audit_row))
    ),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e."occurredAt", e.id) FROM "AuditEvent" e WHERE e."auditId" = (SELECT id FROM audit_row)), '[]'::jsonb)
  )
));
\o
