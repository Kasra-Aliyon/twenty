import { LinkedinThreadParticipantMatchJob } from 'src/modules/linkedin/jobs/linkedin-thread-participant-match.job';
import { type LinkedinParticipantMatcherService } from 'src/modules/linkedin/services/linkedin-participant-matcher.service';

const WORKSPACE_ID = '20202020-1111-4111-8111-111111111111';
const PARTICIPANT_ID = '20202020-2222-4222-8222-222222222222';
const PERSON_ID = '20202020-3333-4333-8333-333333333333';

describe('LinkedinThreadParticipantMatchJob', () => {
  const matchParticipantsByIds = jest.fn();
  const matchParticipantsForPeople = jest.fn();
  const job = new LinkedinThreadParticipantMatchJob({
    matchParticipantsByIds,
    matchParticipantsForPeople,
  } as unknown as LinkedinParticipantMatcherService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs participant and Person-triggered matching work', async () => {
    await job.handle({
      participantIds: [PARTICIPANT_ID],
      personIds: [PERSON_ID],
      workspaceId: WORKSPACE_ID,
    });

    expect(matchParticipantsByIds).toHaveBeenCalledWith({
      participantIds: [PARTICIPANT_ID],
      workspaceId: WORKSPACE_ID,
    });
    expect(matchParticipantsForPeople).toHaveBeenCalledWith({
      personIds: [PERSON_ID],
      workspaceId: WORKSPACE_ID,
    });
  });

  it('does no workspace work for an empty event batch', async () => {
    await job.handle({
      participantIds: [],
      personIds: [],
      workspaceId: WORKSPACE_ID,
    });

    expect(matchParticipantsByIds).not.toHaveBeenCalled();
    expect(matchParticipantsForPeople).not.toHaveBeenCalled();
  });
});
