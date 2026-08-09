# Third-party notice — gesture-lab

The following files in this directory are derived works of **gesture-lab**
(<https://github.com/quiet-node>), used under the MIT License reproduced verbatim below:

| File in this directory | Derived from (upstream path)   |
| ---------------------- | ------------------------------ |
| `handTypes.ts`         | `src/shared/HandTypes.ts`      |
| `handTracker.ts`       | `src/shared/HandTracker.ts`    |
| `gestureDetector.ts`   | `src/shared/GestureDetector.ts` and `src/shared/GestureTypes.ts` |
| `smoothing.ts`         | `src/utils/smoothing.ts`       |
| `handMath.ts`          | `src/utils/math.ts`            |

Those files have been modified (TypeScript strictness, injectable diagnostics, typed camera
failures, string-literal unions in place of `enum`, and removal of unused exports). `pilot.ts`
and `pilot.test.ts` are original work of this project and are not derived from gesture-lab.

The MIT License requires that the copyright notice and permission notice below be included in
all copies or substantial portions of the Software. Do not delete this file.

---

MIT License

Copyright (c) 2024 quiet-node

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
