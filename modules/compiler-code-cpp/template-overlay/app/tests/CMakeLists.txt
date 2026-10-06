# Copyright (c) 2022-2025 Contributors to the Eclipse Foundation
#
# This program and the accompanying materials are made available under the
# terms of the Apache License, Version 2.0 which is available at
# https://www.apache.org/licenses/LICENSE-2.0.
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
# WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
# License for the specific language governing permissions and limitations
# under the License.
#
# SPDX-License-Identifier: Apache-2.0

# SimVehicleApp template overlay (compiler-code-cpp): googletest exactly as the template pins it, then the
# generated tests (app/tests/generated, rewritten by SynCode) and your own tests in app/tests/utests.
include(FetchContent)
FetchContent_Declare(
  googletest
  URL https://github.com/google/googletest/archive/609281088cfefc76f9d0ce82e1ff6c30cc3591e5.zip
)

set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
# SV: offline googletest (no-op unless SV_GOOGLETEST_SRC is set)
if(DEFINED ENV{SV_GOOGLETEST_SRC} AND EXISTS "$ENV{SV_GOOGLETEST_SRC}/CMakeLists.txt")
  set(FETCHCONTENT_SOURCE_DIR_GOOGLETEST "$ENV{SV_GOOGLETEST_SRC}" CACHE PATH "" FORCE)
endif()
FetchContent_MakeAvailable(googletest)

if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/generated/CMakeLists.txt)
  add_subdirectory(generated)
endif()
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/utests/CMakeLists.txt)
  add_subdirectory(utests)
endif()
