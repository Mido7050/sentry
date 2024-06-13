import {useMemo} from 'react';

import {t} from 'sentry/locale';
import type {NewQuery} from 'sentry/types/organization';
import EventView from 'sentry/utils/discover/eventView';
import {DiscoverDatasets} from 'sentry/utils/discover/types';
import {decodeScalar, decodeSorts} from 'sentry/utils/queryString';
import {MutableSearch} from 'sentry/utils/tokenizeSearch';
import {useLocation} from 'sentry/utils/useLocation';
import usePageFilters from 'sentry/utils/usePageFilters';
import {EventSamplesTable} from 'sentry/views/performance/mobile/screenload/screenLoadSpans/eventSamplesTable';
import {useTableQuery} from 'sentry/views/performance/mobile/screenload/screens/screensTable';
import useCrossPlatformProject from 'sentry/views/performance/mobile/useCrossPlatformProject';
import {
  PRIMARY_RELEASE_ALIAS,
  SECONDARY_RELEASE_ALIAS,
} from 'sentry/views/starfish/components/releaseSelector';
import {useReleaseSelection} from 'sentry/views/starfish/queries/useReleases';

const DEFAULT_SORT = {
  kind: 'desc',
  field: 'measurements.time_to_initial_display',
};

type Props = {
  cursorName: string;
  release: string;
  sortKey: string;
  transaction: string;
  showDeviceClassSelector?: boolean;
};

export function ScreenLoadEventSamples({
  cursorName,
  transaction,
  release,
  sortKey,
  showDeviceClassSelector,
}: Props) {
  const location = useLocation();
  const {selection} = usePageFilters();
  const {primaryRelease} = useReleaseSelection();
  const cursor = decodeScalar(location.query?.[cursorName]);
  const {selectedPlatform: platform, isProjectCrossPlatform} = useCrossPlatformProject();

  const deviceClass = decodeScalar(location.query['device.class']);

  const searchQuery = useMemo(() => {
    const mutableQuery = new MutableSearch([
      'transaction.op:ui.load',
      `transaction:${transaction}`,
      `release:${release}`,
    ]);

    if (isProjectCrossPlatform) {
      mutableQuery.addFilterValue('os.name', platform);
    }

    if (deviceClass) {
      if (deviceClass === 'Unknown') {
        mutableQuery.addFilterValue('!has', 'device.class');
      } else {
        mutableQuery.addFilterValue('device.class', deviceClass);
      }
    }

    return mutableQuery;
  }, [deviceClass, isProjectCrossPlatform, platform, release, transaction]);

  const sort = decodeSorts(location.query[sortKey])[0] ?? DEFAULT_SORT;

  const columnNameMap = {
    id: t(
      'Event ID (%s)',
      release === primaryRelease ? PRIMARY_RELEASE_ALIAS : SECONDARY_RELEASE_ALIAS
    ),
    'profile.id': t('Profile'),
    'measurements.time_to_initial_display': t('TTID'),
    'measurements.time_to_full_display': t('TTFD'),
  };

  const newQuery: NewQuery = {
    name: '',
    fields: [
      'id',
      'trace',
      'project.name',
      'profile.id',
      'measurements.time_to_initial_display',
      'measurements.time_to_full_display',
    ],
    query: searchQuery.formatString(),
    dataset: DiscoverDatasets.DISCOVER,
    version: 2,
    projects: selection.projects,
  };

  const eventView = EventView.fromNewQueryWithLocation(newQuery, location);
  eventView.sorts = [sort];

  const {data, isLoading, pageLinks} = useTableQuery({
    eventView,
    enabled: true,
    limit: 4,
    cursor,
    referrer: 'api.starfish.mobile-event-samples',
  });

  return (
    <EventSamplesTable
      eventIdKey="id"
      profileIdKey="profile.id"
      isLoading={isLoading}
      cursorName={cursorName}
      pageLinks={pageLinks}
      eventView={eventView}
      sortKey={sortKey}
      data={data}
      showDeviceClassSelector={showDeviceClassSelector}
      columnNameMap={columnNameMap}
      sort={sort}
    />
  );
}
