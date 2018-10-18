/**
 * Copyright 2015 CANAL+ Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  concat as observableConcat,
  EMPTY,
  merge as observableMerge,
  Observable,
  of as observableOf,
  Subject,
  timer as observableTimer,
} from "rxjs";
import {
  exhaustMap,
  filter,
  finalize,
  ignoreElements,
  map,
  mergeMap,
  shareReplay,
  switchMap,
  takeUntil,
} from "rxjs/operators";
import { MediaError } from "../../errors";
import log from "../../log";
import Manifest, {
  Period,
} from "../../manifest";
import ABRManager from "../abr";
import PeriodBufferManager, {
  IPeriodBufferManagerEvent,
} from "../buffer";
import { SegmentPipelinesManager } from "../pipelines";
import SourceBufferManager, {
  ITextTrackSourceBufferOptions,
} from "../source_buffers";
import createBufferClock from "./create_buffer_clock";
import { setDurationToMediaSource } from "./create_media_source";
import { maintainEndOfStream } from "./end_of_stream";
import EVENTS from "./events_generators";
import seekAndLoadOnMediaEvents from "./initial_seek_and_play";
import refreshManifest from "./refresh_manifest";
import SpeedManager from "./speed_manager";
import StallingManager from "./stalling_manager";
import {
  IManifestUpdateEvent,
  ISpeedChangedEvent,
  IStalledEvent,
  IStreamClockTick,
  IStreamLoadedEvent,
  IStreamWarningEvent,
} from "./types";

// Arguments for the StreamLoader
export interface IStreamLoaderArgument {
  mediaElement : HTMLMediaElement; // Media Element on which the content will be
                                   // streamed
  manifest : Manifest; // Manifest of the content we want to stream
  clock$ : Observable<IStreamClockTick>; // Emit position informations
  speed$ : Observable<number>; // Emit the speed.
                               // /!\ Should replay the last value on subscription.
  abrManager : ABRManager;
  segmentPipelinesManager : SegmentPipelinesManager<any>;
  fetchManifest : (url : string) => Observable<Manifest>;
  bufferOptions : { // Buffer-related options
    wantedBufferAhead$ : Observable<number>;
    maxBufferAhead$ : Observable<number>;
    maxBufferBehind$ : Observable<number>;
    offlineRetry? : number;
    segmentRetry? : number;
    textTrackOptions : ITextTrackSourceBufferOptions;
    manualBitrateSwitchingMode : "seamless"|"direct";
  };
}

// Events emitted by the StreamLoader
export type IStreamLoaderEvent =
  IManifestUpdateEvent |
  IStalledEvent |
  ISpeedChangedEvent |
  IStreamLoadedEvent |
  IStreamWarningEvent |
  IPeriodBufferManagerEvent;

/**
 * Returns a function allowing to load or reload the content in arguments into
 * a single or multiple MediaSources.
 * @param {Object} loadStreamArguments
 * @returns {Observable}
 */
export default function StreamLoader({
  mediaElement,
  manifest,
  clock$,
  speed$,
  bufferOptions,
  abrManager,
  segmentPipelinesManager,
  fetchManifest,
} : IStreamLoaderArgument) : (
  mediaSource : MediaSource,
  position : number,
  autoPlay : boolean
) => Observable<IStreamLoaderEvent> {
  /**
   * Load the content on the given MediaSource.
   * @param {MediaSource} mediaSource
   * @param {number} initialTime
   * @param {boolean} autoPlay
   */
  return function loadStreamOnMediaSource(
    mediaSource : MediaSource,
    initialTime : number,
    autoPlay : boolean
  ) {
    setDurationToMediaSource(mediaSource, manifest.getDuration());

    const initialPeriod = manifest.getPeriodForTime(initialTime);
    if (initialPeriod == null) {
      throw new MediaError("MEDIA_STARTING_TIME_NOT_FOUND", null, true);
    }

    // Creates SourceBufferManager allowing to create and keep track of a single
    // SourceBuffer per type.
    const sourceBufferManager = new SourceBufferManager(mediaElement, mediaSource);

    // Initialize all native source buffers from the first period at the same
    // time.
    // We cannot lazily create native sourcebuffers since the spec does not
    // allow adding them during playback.
    //
    // From https://w3c.github.io/media-source/#methods
    //    For example, a user agent may throw a QuotaExceededError
    //    exception if the media element has reached the HAVE_METADATA
    //    readyState. This can occur if the user agent's media engine
    //    does not support adding more tracks during playback.
    createNativeSourceBuffersForPeriod(sourceBufferManager, initialPeriod);

    const {
      seek$,
      load$,
    } = seekAndLoadOnMediaEvents(mediaElement, initialTime, autoPlay);

    const bufferClock$ = createBufferClock(manifest, clock$, seek$, speed$, initialTime);

    // Will be used to cancel any endOfStream tries when the contents resume
    const cancelEndOfStream$ = new Subject<null>();

    // Creates Observable which will manage every Buffer for the given Content.
    const buffers$ = PeriodBufferManager(
      { manifest, initialPeriod },
      bufferClock$,
      abrManager,
      sourceBufferManager,
      segmentPipelinesManager,
      bufferOptions
    ).pipe(
      mergeMap((evt) : Observable<IStreamLoaderEvent> => {
        switch (evt.type) {
          case "end-of-stream":
            return maintainEndOfStream(mediaSource)
              .pipe(ignoreElements(), takeUntil(cancelEndOfStream$));
          case "resume-stream":
            cancelEndOfStream$.next(null);
            return EMPTY;
          case "discontinuity-encountered":
            if (SourceBufferManager.isNative(evt.value.bufferType)) {
              log.warn("explicit discontinuity seek", evt.value.nextTime);
              mediaElement.currentTime = evt.value.nextTime;
            }
            return EMPTY;
          default:
            return observableOf(evt);
        }
      }),
      shareReplay()
    );

    // Create Speed Manager, an observable which will set the speed set by the
    // user on the media element while pausing a little longer while the buffer
    // is stalled.
    const speedManager$ = SpeedManager(mediaElement, speed$, clock$, {
      pauseWhenStalled: true,
    }).pipe(map(EVENTS.speedChanged));

    // Create Stalling Manager, an observable which will try to get out of
    // various infinite stalling issues
    const stallingManager$ = StallingManager(mediaElement, clock$)
      .pipe(map(EVENTS.stalled));

    /**
     * Creates an observable which will refresh the manifest every
     * "minimumUpdatePeriod". The minimum update period is refreshed
     * each time a new manifest is downloaded.
     * @param {Object} manifest
     * @returns {Observable}
     */
    function recursivelyUpdateManifest(
      manifestToUpdate: Manifest
    ): Observable<IManifestUpdateEvent> {
      const { minimumUpdatePeriod } = manifestToUpdate;

      if (minimumUpdatePeriod != null && minimumUpdatePeriod > 0) {
        const now = Date.now() / 1000;
        const refreshDelay = Math.max(
          0,
          (minimumUpdatePeriod * 1000) - (now -  manifestToUpdate.loadedAt)
        );
        return observableTimer(refreshDelay).pipe(
          mergeMap(() => {
            return observableConcat(
              refreshManifest(fetchManifest, manifestToUpdate),
              recursivelyUpdateManifest(manifestToUpdate)
            );
          })
        );
      }
      return EMPTY;
    }

    const bufferNeedsToRefreshManifest$ = buffers$.pipe(
      filter((evt) => evt.type === "needs-manifest-refresh")
    );

    // The recursive refreshing logic is reset each time the buffer
    // needs a manifest refresh.
    const updateManifest$ =
      observableMerge(
        recursivelyUpdateManifest(manifest).pipe(
          takeUntil(bufferNeedsToRefreshManifest$)
        ),
        bufferNeedsToRefreshManifest$.pipe(
          exhaustMap(() => refreshManifest(fetchManifest, manifest)),
          switchMap((evt) => {
            return observableConcat(
              observableOf(evt),
              recursivelyUpdateManifest(manifest)
            );
          })
        )
      );

    const loadedEvent$ = load$
      .pipe(mergeMap((evt) => {
        if (evt === "autoplay-blocked") {
          const error = new MediaError("MEDIA_ERR_BLOCKED_AUTOPLAY", null, false);
          return observableOf(EVENTS.warning(error), EVENTS.loaded());
        }
        return observableOf(EVENTS.loaded());
      }));

    return observableMerge(
      updateManifest$,
      loadedEvent$,
      buffers$,
      speedManager$,
      stallingManager$
    ).pipe(finalize(() => {
      // clean-up every created SourceBuffers
      sourceBufferManager.disposeAll();
    }));
  };

  /**
   * Create all native SourceBuffers needed for a given Period.
   *
   * Native Buffers have the particulary to need to be created at the beginning of
   * the content.
   * Custom source buffers (entirely managed in JS) can generally be created and
   * disposed at will during the lifecycle of the content.
   * @param {SourceBufferManager} sourceBufferManager
   * @param {Period} period
   */
  function createNativeSourceBuffersForPeriod(
    sourceBufferManager : SourceBufferManager,
    period : Period
  ) : void {
    Object.keys(period.adaptations).forEach(bufferType => {
      if (SourceBufferManager.isNative(bufferType)) {
        const adaptations = period.adaptations[bufferType] || [];
        const representations = adaptations ?
          adaptations[0].representations : [];
        if (representations.length) {
          const codec = representations[0].getMimeTypeString();
          sourceBufferManager.createSourceBuffer(bufferType, codec);
        }
      }
    });
  }
}
