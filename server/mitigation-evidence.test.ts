import { describe, expect, it, vi } from 'vitest'
import { assertMitigationEvidence } from './mitigation-evidence.js'

const transition = {
  ticketId: 'ticket-1',
  actionItemId: 'action-1',
  willCompleteActivity: true,
  wasActivityCompleted: false,
}

const makeClient = (localCount: number, driveCount: number) => ({
  actionItem: { findUnique: vi.fn(async () => ({ actionPlan: { riskId: 'risk-1' } })) },
  ticket: { findUnique: vi.fn(async () => ({ createdBy: { companyId: 'company-1' }, assignedTo: null, actionItem: { actionPlan: { diagnostic: { companyId: 'company-1' } } } })) },
  ticketEvidenceFile: { count: vi.fn(async () => localCount) },
  ticketDriveReference: { count: vi.fn(async () => driveCount) },
})

describe('mitigation evidence gate', () => {
  it('accepts a PDF reference from Google Drive as evidence', async () => {
    await expect(assertMitigationEvidence(makeClient(0, 1) as never, transition)).resolves.toBeUndefined()
  })

  it('rejects a mitigation without local or Drive evidence', async () => {
    await expect(assertMitigationEvidence(makeClient(0, 0) as never, transition)).rejects.toMatchObject({ reason: 'MITIGATION_EVIDENCE_REQUIRED' })
  })

  it('scopes evidence to the ticket company and authorized uploaders', async () => {
    const client = makeClient(1, 0)
    await expect(assertMitigationEvidence(client as never, transition)).resolves.toBeUndefined()

    expect(client.ticketEvidenceFile.count).toHaveBeenCalledWith({
      where: {
        ticketId: transition.ticketId,
        uploadedBy: { OR: [{ companyId: 'company-1' }, { companyId: null }] },
      },
    })
    expect(client.ticketDriveReference.count).toHaveBeenCalledWith({
      where: {
        ticketId: transition.ticketId,
        companyId: 'company-1',
        createdBy: { OR: [{ companyId: 'company-1' }, { companyId: null }] },
        connection: { companyId: 'company-1' },
      },
    })
  })
})
