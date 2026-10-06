// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#ifndef SIMVEHICLEAPP_RT_ACCESS_HPP
#define SIMVEHICLEAPP_RT_ACCESS_HPP

#include "simvehicleapp/rt/Value.hpp"

#include <functional>
#include <optional>
#include <string>

namespace simvehicleapp::rt {

/**
 * The vehicle as the runtime sees it (ADR-0021 §3): the only place that talks to the Velocitas SDK
 * (`VelocitasVehicleAccess`) or to a test double (`testing::MockVehicle`).
 *
 * Every callback must run on the runtime's strand (an implementation on SDK threads posts them).
 */
class IVehicleAccess {
public:
    virtual ~IVehicleAccess() = default;
    /** Current value before the app starts (the baseline of change triggers); may block. */
    virtual std::optional<Value> current(const std::string& path, const std::string& type) = 0;
    /** Every later value of `path` (one subscription per path, shared by all triggers). */
    virtual void subscribe(const std::string& path, const std::string& type,
                           std::function<void(const Value&)> onValue) = 0;
    /** Fresh read; `done(value, error)` — an empty error means success. */
    virtual void get(const std::string& path, const std::string& type,
                     std::function<void(std::optional<Value>, const std::string&)> done) = 0;
    /** Rejects a write before it is sent (allowed values / bounds known locally); "" = accepted. */
    virtual std::string checkWrite(const std::string& path, const std::string& type, const Value& value) {
        (void)path, (void)type, (void)value;
        return {};
    }
    /** Sets the actuator target; `done(error)` acknowledges it (null `done`: fire and forget). */
    virtual void set(const std::string& path, const std::string& type, const Value& value,
                     std::function<void(const std::string&)> done) = 0;
};

/** MQTT as the runtime sees it (Velocitas pub/sub client or `testing::MockPubSub`). */
class IPubSub {
public:
    /**
     * A message: `onlyFilter` is the subscription it came through when the client cannot tell the
     * topic (Velocitas SDK); null means "deliver to every trigger whose filter matches `topic`".
     */
    using Handler = std::function<void(const std::string& topic, const std::string& payload,
                                       const std::string* onlyFilter)>;
    virtual ~IPubSub() = default;
    virtual void setHandler(Handler handler) = 0;
    virtual void subscribe(const std::string& filter) = 0;
    virtual void publish(const std::string& topic, const std::string& payload) = 0;
};

/** MQTT topic filter match (`+` one level, `#` the rest). */
bool topicMatches(const std::string& filter, const std::string& topic);

} // namespace simvehicleapp::rt

#endif // SIMVEHICLEAPP_RT_ACCESS_HPP
