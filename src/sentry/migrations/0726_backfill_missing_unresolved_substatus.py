# Generated by Django 5.0.6 on 2024-06-07 04:35

from datetime import timedelta

from django.db import migrations
from django.utils import timezone

from sentry.new_migrations.migrations import CheckedMigration

# Copying constants defined in the models


class GroupHistoryStatus:
    REGRESSED = 7


class GroupSubStatus:
    ONGOING = 3
    REGRESSED = 6
    NEW = 7


class GroupStatus:
    UNRESOLVED = 0


# End copy


def backfill_missing_substatus(apps, schema_editor):
    now = timezone.now()
    Group = apps.get_model("sentry", "Group")
    GroupHistory = apps.get_model("sentry", "GroupHistory")

    seven_days_ago = now - timedelta(days=7)

    groups = Group.objects.filter(status=GroupStatus.UNRESOLVED, substatus=None)
    group_history = GroupHistory.objects.filter(
        date_added__gte=seven_days_ago, group__in=groups, status=GroupHistoryStatus.REGRESSED
    )

    for group in groups:
        if group.first_seen > seven_days_ago:
            group.substatus = GroupSubStatus.NEW
            continue

        histories = group_history.filter(group=group).order_by("-date_added")
        if histories.exists():
            group.substatus = GroupSubStatus.REGRESSED
            continue

        group.substatus = GroupSubStatus.ONGOING

    Group.objects.bulk_update(groups, ["substatus"])


class Migration(CheckedMigration):
    # This flag is used to mark that a migration shouldn't be automatically run in production.
    # This should only be used for operations where it's safe to run the migration after your
    # code has deployed. So this should not be used for most operations that alter the schema
    # of a table.
    # Here are some things that make sense to mark as post deployment:
    # - Large data migrations. Typically we want these to be run manually so that they can be
    #   monitored and not block the deploy for a long period of time while they run.
    # - Adding indexes to large tables. Since this can take a long time, we'd generally prefer to
    #   run this outside deployments so that we don't block them. Note that while adding an index
    #   is a schema change, it's completely safe to run the operation after the code has deployed.
    # Once deployed, run these manually via: https://develop.sentry.dev/database-migrations/#migration-deployment

    is_post_deployment = True

    dependencies = [
        ("sentry", "0725_create_sentry_groupsearchview_table"),
    ]

    operations = [
        migrations.RunPython(
            backfill_missing_substatus,
            migrations.RunPython.noop,
            hints={"tables": ["sentry_groupedmessage"]},
        ),
    ]
