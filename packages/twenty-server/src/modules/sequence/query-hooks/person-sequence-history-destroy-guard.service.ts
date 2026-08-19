import { Injectable } from '@nestjs/common';

import { msg } from '@lingui/core/macro';
import { isDefined } from 'twenty-shared/utils';
import { In } from 'typeorm';

import {
  CommonQueryRunnerException,
  CommonQueryRunnerExceptionCode,
} from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { STANDARD_ERROR_MESSAGE } from 'src/engine/api/common/common-query-runners/errors/standard-error-message.constant';
import { GraphqlQueryParser } from 'src/engine/api/graphql/graphql-query-runner/graphql-query-parsers/graphql-query.parser';
import { type ObjectRecordFilter } from 'src/engine/api/graphql/workspace-query-builder/interfaces/object-record.interface';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { getWorkspaceContext } from 'src/engine/twenty-orm/storage/orm-workspace-context.storage';
import { resolveRolePermissionConfig } from 'src/engine/twenty-orm/utils/resolve-role-permission-config.util';
import { getObjectMetadataFromEntityTarget } from 'src/engine/twenty-orm/utils/get-object-metadata-from-entity-target.util';
import { type LinkedinActionWorkspaceEntity } from 'src/modules/linkedin/standard-objects/linkedin-action.workspace-entity';
import { type PersonWorkspaceEntity } from 'src/modules/person/standard-objects/person.workspace-entity';
import { type SequenceEnrollmentWorkspaceEntity } from 'src/modules/sequence/standard-objects/sequence-enrollment.workspace-entity';

type PreparePermanentPersonDestroyArgs = {
  authContext: WorkspaceAuthContext;
  filter: Partial<ObjectRecordFilter>;
  personIdsToCheckForHistory?: string[];
  workspaceEntityManager: WorkspaceEntityManager;
};

const PERSON_OBJECT_NAME = 'person';

@Injectable()
export class PersonSequenceHistoryDestroyGuardService {
  async preparePermanentPersonDestroy({
    authContext,
    filter,
    personIdsToCheckForHistory,
    workspaceEntityManager,
  }: PreparePermanentPersonDestroyArgs): Promise<string[]> {
    const personIds = await this.lockTargetPeople({
      authContext,
      filter,
      workspaceEntityManager,
    });

    const historyPersonIds = isDefined(personIdsToCheckForHistory)
      ? personIds.filter((personId) =>
          personIdsToCheckForHistory.includes(personId),
        )
      : personIds;

    if (historyPersonIds.length === 0) return personIds;

    const sequenceEnrollmentRepository =
      workspaceEntityManager.getRepository<SequenceEnrollmentWorkspaceEntity>(
        'sequenceEnrollment',
        { shouldBypassPermissionChecks: true },
        authContext,
      );
    const linkedinActionRepository =
      workspaceEntityManager.getRepository<LinkedinActionWorkspaceEntity>(
        'linkedinAction',
        { shouldBypassPermissionChecks: true },
        authContext,
      );
    const sequenceEnrollment = await sequenceEnrollmentRepository.findOne({
      where: { personId: In(historyPersonIds) },
      withDeleted: true,
      select: ['id'],
    });

    if (isDefined(sequenceEnrollment)) {
      this.throwPermanentDeletionBlocked();
    }

    const linkedinAction = await linkedinActionRepository.findOne({
      where: { personId: In(historyPersonIds) },
      withDeleted: true,
      select: ['id'],
    });

    if (isDefined(linkedinAction)) {
      this.throwPermanentDeletionBlocked();
    }

    return personIds;
  }

  private async lockTargetPeople({
    authContext,
    filter,
    workspaceEntityManager,
  }: PreparePermanentPersonDestroyArgs): Promise<string[]> {
    const workspaceContext = getWorkspaceContext();
    const rolePermissionConfig = resolveRolePermissionConfig({
      authContext,
      userWorkspaceRoleMap: workspaceContext.userWorkspaceRoleMap,
      apiKeyRoleMap: workspaceContext.apiKeyRoleMap,
    });

    if (!isDefined(rolePermissionConfig)) {
      throw new CommonQueryRunnerException(
        'Invalid auth context',
        CommonQueryRunnerExceptionCode.INVALID_AUTH_CONTEXT,
        { userFriendlyMessage: STANDARD_ERROR_MESSAGE },
      );
    }

    const personRepository =
      workspaceEntityManager.getRepository<PersonWorkspaceEntity>(
        PERSON_OBJECT_NAME,
        rolePermissionConfig,
        authContext,
      );
    const personObjectMetadata = getObjectMetadataFromEntityTarget(
      PERSON_OBJECT_NAME,
      workspaceEntityManager.internalContext,
    );
    const graphqlQueryParser = new GraphqlQueryParser(
      personObjectMetadata,
      workspaceContext.flatObjectMetadataMaps,
      workspaceContext.flatFieldMetadataMaps,
    );
    const queryBuilder =
      personRepository.createQueryBuilder(PERSON_OBJECT_NAME);

    graphqlQueryParser.applyFilterToBuilder(
      queryBuilder,
      PERSON_OBJECT_NAME,
      filter,
    );

    const targetPeople = await queryBuilder
      .select(`${PERSON_OBJECT_NAME}.id`, 'id')
      .withDeleted()
      .orderBy(`${PERSON_OBJECT_NAME}.id`, 'ASC')
      .setLock('pessimistic_write', undefined, [PERSON_OBJECT_NAME])
      .getRawMany<{ id: string }>();

    return [...new Set(targetPeople.map(({ id }) => id))];
  }

  private throwPermanentDeletionBlocked(): never {
    throw new CommonQueryRunnerException(
      'Person permanent deletion would remove sequence or LinkedIn action history',
      CommonQueryRunnerExceptionCode.BAD_REQUEST,
      {
        userFriendlyMessage: msg`People with sequence or LinkedIn activity history cannot be permanently deleted. Archive them instead.`,
      },
    );
  }
}
