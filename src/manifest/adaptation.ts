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

import arrayFind from "array-find";
import objectAssign from "object-assign";
import { Subject } from "rxjs";
import { isCodecSupported } from "../compat";
import { ICustomError } from "../errors";
import MediaError from "../errors/MediaError";
import log from "../log";
import generateNewId from "../utils/id";
import Representation, {
  IRepresentationArguments,
} from "./representation";

export type IAdaptationType = "video"|"audio"|"text"|"image";

export const SUPPORTED_ADAPTATIONS_TYPE: IAdaptationType[] =
  ["audio", "video", "text", "image"];

interface IRepresentationInfos {
  bufferType: IAdaptationType;
  language?: string;
  isAudioDescription? : boolean;
  isClosedCaption? : boolean;
  normalizedLanguage? : string;
}

export type IRepresentationFilter = (
  representation: Representation,
  adaptationInfos: IRepresentationInfos
) => boolean;

export interface IAdaptationArguments {
  // -- required
  representations : IRepresentationArguments[];
  type : IAdaptationType;

  // -- optional
  audioDescription? : boolean;
  closedCaption? : boolean;
  id? : number|string;
  language? : string;
  manuallyAdded? : boolean;
  normalizedLanguage? : string;
}

/**
 * Normalized Adaptation structure.
 * @class Adaptation
 */
export default class Adaptation {
  // required
  public readonly id : string|number;
  public readonly representations : Representation[];
  public readonly type : IAdaptationType;

  // optional
  public isAudioDescription? : boolean;
  public isClosedCaption? : boolean;
  public language? : string;
  public manuallyAdded? : boolean;
  public normalizedLanguage? : string;

  /**
   * @constructor
   * @param {Object} args
   */
  constructor(
    args : IAdaptationArguments,
    warning$ : Subject<Error|ICustomError>,
    representationFilter? : IRepresentationFilter
  ) {
    const nId = generateNewId();
    this.id = args.id == null ? nId : "" + args.id;
    this.type = args.type;

    const hadRepresentations = !!args.representations.length;
    const argsRepresentations =
      filterSupportedRepresentations(args.type, args.representations);

    if (hadRepresentations && argsRepresentations.length === 0) {
      log.warn("Incompatible codecs for adaptation", args);
      const error = new MediaError("MANIFEST_INCOMPATIBLE_CODECS_ERROR", null, false);
      warning$.next(error);
    }

    if (args.language != null) {
      this.language = args.language;
    }

    if (args.normalizedLanguage != null) {
      this.normalizedLanguage = args.normalizedLanguage;
    }

    if (args.closedCaption != null) {
      this.isClosedCaption = args.closedCaption;
    }
    if (args.audioDescription != null) {
      this.isAudioDescription = args.audioDescription;
    }

    this.representations = argsRepresentations
      .map(representation =>
        new Representation(objectAssign({ rootId: this.id }, representation))
      )
      .sort((a, b) => a.bitrate - b.bitrate)
      .filter(representation => {
        if (representationFilter == null) {
          return true;
        }
        return representationFilter(representation, {
          bufferType: this.type,
          language: this.language,
          normalizedLanguage: this.normalizedLanguage,
          isClosedCaption: this.isClosedCaption,
          isAudioDescription: this.isAudioDescription,
        });
      });

    // for manuallyAdded adaptations (not in the manifest)
    this.manuallyAdded = !!args.manuallyAdded;
  }

  /**
   * @returns {Array.<Number>}
   */
  getAvailableBitrates() : number[] {
    return this.representations
      .map(representation => representation.bitrate);
  }

  /**
   * @param {Number|string} wantedId
   * @returns {Representation}
   */
  getRepresentation(wantedId : number|string) : Representation|undefined {
    return arrayFind(this.representations, ({ id }) => wantedId === id);
  }

  /**
   * @param {Number} bitrate
   * @returns {Array.<Representations>|null}
   */
  getRepresentationsForBitrate(bitrate : number) : Representation[]|null {
    return this.representations.filter(representation =>
      representation.bitrate === bitrate) || null;
  }
}

/**
 * @param {string} adaptationType
 * @param {Array.<Object>} representations
 * @returns {Array.<Object>}
 */
function filterSupportedRepresentations(
  adaptationType : string,
  representations : IRepresentationArguments[]
) : IRepresentationArguments[] {
  if (adaptationType === "audio" || adaptationType === "video") {
    return representations.filter((representation) => {
      return isCodecSupported(getCodec(representation));
    });
  }
  // TODO for the other types?
  return representations;

  /**
   * Construct the codec string from given codecs and mimetype.
   * @param {Object} representation
   * @returns {string}
   */
  function getCodec(
    representation : IRepresentationArguments
  ) : string {
    const { codecs = "", mimeType = "" } = representation;
    return `${mimeType};codecs="${codecs}"`;
  }
}
