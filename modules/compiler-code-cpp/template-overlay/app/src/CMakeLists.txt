# SimVehicleApp template overlay (compiler-code-cpp, ADR-0023 §3) — installed once when the project is created.
# Target `app` = generated code (app/src/generated, rewritten by SynCode) + your code in app/src/user
# + the vendored SimVehicleApp runtime (app/src/simvehicleapp-runtime).

set(TARGET_NAME "app")

set(SV_RT_VELOCITAS ON CACHE BOOL "Build the Velocitas SDK adapter of the runtime" FORCE)
add_subdirectory(simvehicleapp-runtime)
include(${CMAKE_CURRENT_SOURCE_DIR}/generated/generated.cmake)
file(GLOB SV_USER_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/user/*.cpp)

add_executable(${TARGET_NAME}
    ${SV_GENERATED_SOURCES}
    ${SV_USER_SOURCES}
)

target_include_directories(${TARGET_NAME}
    PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${SV_GENERATED_DIR}
)

target_link_libraries(${TARGET_NAME}
    ${SERVICE_LIBS}
    simvehicleapp-runtime-velocitas
    vehicle-app-sdk::vehicle-app-sdk
    vehicle-model::vehicle-model
    nlohmann_json::nlohmann_json
)
