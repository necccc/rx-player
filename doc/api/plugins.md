# Plugins ######################################################################


## Overview ####################################################################

To allow the player to be extended, a system of "plugins" has been added.

Those plugins are often under the form of functions passed as an argument to the
``loadVideo`` API call.



<a name="segmentLoader"></a>
## segmentLoader ###############################################################

The segmentLoader is a function that can be included in the ``transportOptions``
of the ``loadVideo`` API call.

A segmentLoader allows to define a custom audio/video segment loader (it might
on the future work for other types of segments, so always check the type if you
only want those two).

The segment loader is the part performing the segment request. One usecase where
you might want to set your own segment loader is to integrate Peer-to-Peer
segment downloading through the player.

To give a complete example, here is a segment loader which uses an XHR (it has
no use, as our implementation does the same thing and more):
```js
/**
 * @param {Object} infos - infos about the segment to download
 * @param {string} infos.url - the url the segment request should normally be on
 * @param {Object} infos.adaptation - the adaptation containing the segment.
 * More information on its structure can be found on the documentation linked
 * below [1]
 * @param {Object} infos.representation - the representation containing the
 * segment.
 * More information on its structure can be found on the documentation linked
 * below [2]
 * @param {Object} infos.segment - the segment itself
 * More information on its structure can be found on the documentation linked
 * below [3]

 * @param {Object} callbacks
 * @param {Function} callbacks.resolve - Callback to call when the request is
 * finished with success. It should be called with an object with at least 3
 * properties:
 *   - data {ArrayBuffer} - the segment data
 *   - duration {Number} - the duration of the request, in ms
 *   - size {Number} - size, in bytes, of the total downloaded response.
 * @param {Function} callbacks.reject - Callback to call when an error is
 * encountered. If you relied on an XHR, it is recommended to include it as an
 * object property named "xhr" in the argument.
 * @param {Function} callbacks.fallback - Callback to call if you want to call
 * our default implementation instead for this segment. No argument is needed.

 * @returns {Function|undefined} - If a function is defined in the return value,
 * it will be called if and when the request is canceled.
 */
const customSegmentLoader = (infos, callbacks) => {

  // we will only use this custom loader for videos segments.
  if (infos.adaptation.type !== "video") {
    callbacks.fallback();
    return;
  }

  const xhr = new XMLHttpRequest();
  const sentTime = Date.now();

  xhr.onload = (r) => {
    if (200 <= xhr.status && xhr.status < 300) {
      const duration = Date.now() - sentTime;
      const size = r.total;
      const data = xhr.response;
      callbacks.resolve({ duration, size, data });
    } else {
      const err = new Error("didn't work");
      err.xhr = xhr;
      callbacks.reject(err);
    }
  };

  xhr.onerror = () => {
    const err = new Error("didn't work");
    err.xhr = xhr;
    callbacks.reject(err);
  };

  xhr.open("GET", infos.url);
  xhr.responseType = "arraybuffer";

  const range = infos.segment.range;
  if (range) {
    if (range[1] && range[1] !== Infinity) {
      xhr.setRequestHeader("Range", `bytes=${range[0]}-${range[1]}`);
    } else {
      xhr.setRequestHeader("Range", `bytes=${range[0]}-`);
    }
  }

  xhr.send();

  return () => {
    xhr.abort();
  };
};
```

[1] [Adaptation structure](./manifest.md#adaptation)

[2] [Representation structure](./manifest.md#representation)

[3] [Segment structure](./manifest.md#segment)



<a name="manifestLoader"></a>
## manifestLoader ##############################################################

The manifestLoader is a function that can be included in the
``transportOptions`` of the ``loadVideo`` API call.

A manifestLoader allows to define a custom manifest loader.

The manifest loader is the part performing the manifest request.

Here is a manifest loader which uses an XHR (it has no use, as our
implementation does the same thing and more):

```js
/**
 * @param {string} url - the url the manifest request should normally be on

 * @param {Object} callbacks
 * @param {Function} callbacks.resolve - Callback to call when the request is
 * finished with success. It should be called with an object with at least 3
 * properties:
 *   - data {Document|String} - the manifest data
 *   - duration {Number} - the duration of the request, in ms
 *   - size {Number} - size, in bytes, of the total downloaded response.
 * @param {Function} callbacks.reject - Callback to call when an error is
 * encountered. If you relied on an XHR, it is recommended to include it as an
 * object property named "xhr" in the argument.
 * @param {Function} callbacks.fallback - Callback to call if you want to call
 * our default implementation instead for this segment. No argument is needed.

 * @returns {Function|undefined} - If a function is defined in the return value,
 * it will be called if and when the request is canceled.
 */
const customManifestLoader = (url, callbacks) => {
  const xhr = new XMLHttpRequest();
  const sentTime = Date.now();

  xhr.onload = (r) => {
    if (200 <= xhr.status && xhr.status < 300) {
      const duration = Date.now() - sentTime;
      const size = r.total;
      const data = xhr.response;
      callbacks.resolve({ duration, size, data });
    } else {
      const err = new Error("didn't work");
      err.xhr = xhr;
      callbacks.reject(err);
    }
  };

  xhr.onerror = () => {
    const err = new Error("didn't work");
    err.xhr = xhr;
    callbacks.reject(err);
  };

  xhr.open("GET", url);
  xhr.responseType = "document";

  xhr.send();

  return () => {
    xhr.abort();
  };
};
```


<a name="representationFilter"></a>
## representationFilter ########################################################

The representationFilter is a function that can be included in the
``transportOptions`` of the ``loadVideo`` API call.

A representationFilter allows you to filter out `Representation`s (i.e. media
qualities) based on its attributes.

The representationFilter will be called each time we load a manifest with two
arguments:

  - representation ``{Representation}``: The concerned ``Representation``.
    A `Representation` structure's is described [in the Manifest structure
    documentation](./manifest.md#representation).

  - representationInfos ``{Object}``: Basic informations about this
    ``Representation``. Contains the following keys:

      - bufferType ``{string}``: The concerned type of buffer. Can be
        ``"video"``, ``"audio"``, ``"text"`` (for subtitles) or ``"image"``
        (for thumbnail).

      - language ``{string|undefined}``: The language the ``Representation``
        is in, as announced by the manifest.

      - normalizedLanguage ``{string|undefined}``: An attempt to translate the
        language into an ISO 639-3 code.
        If the translation attempt fails (no corresponding ISO 639-3 language
        code is found), it will equal the value of ``language``

      - isClosedCaption ``{Boolean|undefined}``: If true, the ``Representation``
        links to subtitles with added hints for the hard of hearing.

      - isAudioDescription ``{Boolean|undefined}``: If true, the
        ``Representation`` links to an audio track with added commentary for
        the visually impaired.


This function should then returns ``true`` if the ``Representation`` should be
kept or ``false`` if it should be removed.

For example, here is a `representationFilter` that removes video
`Representation`s with a video resolution higher than HD (1920x1080):

```js
/**
 * @param {Object} representation - The representation object, as defined in
 * the documentation linked bellow [1]
 * @param {Object} infos - supplementary informations about the given
 * representation.
 * @returns {boolean}
 */
function representationFilter(representation, infos) {
  if (infos.bufferType === "video") {
    // If video representation, allows only those for which the height and width
    // is known to be below our 1920x1080 limit
    const { width, height } = representation;
    return width != null && height != null && width <= 1920 && height <= 1080;
  }

  // Otherwise, allow all non-video representations
  return true;
}
```

[1] [Representation structure](./manifest.md#representation)
