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

import request from "../../utils/request";
import { ILoaderObservable } from "../types";

/**
 * Period loader.
 * @param {string} url
 * @param {boolean} ignoreProgressEvents
 */
function regularPeriodLoader(
  url: string,
  ignoreProgressEvents?: true
) {
  return request({
    url,
    responseType: "text",
    ignoreProgressEvents,
  });
}

/**
 * Generate a period loader for the application
 * @param {Object} options
 * @returns {Function}
 */
const periodPreLoader = (
  options: {
    ignoreProgressEvents?: true;
  }) => (url: string) : ILoaderObservable<string> => {
    const { ignoreProgressEvents } = options;
    return regularPeriodLoader(url, ignoreProgressEvents);
};

export default periodPreLoader;
