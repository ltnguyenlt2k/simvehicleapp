// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#include "simvehicleapp/rt/Velocitas.hpp"

#include "sdk/DataPointReply.h"
#include "sdk/DataPointValue.h"
#include "sdk/Logger.h"
#include "sdk/Status.h"

namespace simvehicleapp::rt {

namespace {

using velocitas::DataPointValue;

template <class T> Value typedToValue(const DataPointValue& v) {
    return toValue(static_cast<const velocitas::TypedDataPointValue<T>&>(v).value());
}

/** SDK value ⇒ runtime value; nullopt when the broker has no valid value. */
std::optional<Value> fromSdk(const DataPointValue& v) {
    if (!v.isValid()) {
        return std::nullopt;
    }
    using T = DataPointValue::Type;
    switch (v.getType()) {
    case T::BOOL:
        return typedToValue<bool>(v);
    case T::INT8:
        return typedToValue<int8_t>(v);
    case T::INT16:
        return typedToValue<int16_t>(v);
    case T::INT32:
        return typedToValue<int32_t>(v);
    case T::INT64:
        return typedToValue<int64_t>(v);
    case T::UINT8:
        return typedToValue<uint8_t>(v);
    case T::UINT16:
        return typedToValue<uint16_t>(v);
    case T::UINT32:
        return typedToValue<uint32_t>(v);
    case T::UINT64:
        return typedToValue<uint64_t>(v);
    case T::FLOAT:
        return typedToValue<float>(v);
    case T::DOUBLE:
        return typedToValue<double>(v);
    case T::STRING:
        return typedToValue<std::string>(v);
    case T::BOOL_ARRAY: {
        Value out = Value::array();
        for (bool b : static_cast<const velocitas::TypedDataPointValue<std::vector<bool>>&>(v).value()) {
            out.push_back(b);
        }
        return out;
    }
    case T::INT8_ARRAY:
        return typedToValue<std::vector<int8_t>>(v);
    case T::INT16_ARRAY:
        return typedToValue<std::vector<int16_t>>(v);
    case T::INT32_ARRAY:
        return typedToValue<std::vector<int32_t>>(v);
    case T::INT64_ARRAY:
        return typedToValue<std::vector<int64_t>>(v);
    case T::UINT8_ARRAY:
        return typedToValue<std::vector<uint8_t>>(v);
    case T::UINT16_ARRAY:
        return typedToValue<std::vector<uint16_t>>(v);
    case T::UINT32_ARRAY:
        return typedToValue<std::vector<uint32_t>>(v);
    case T::UINT64_ARRAY:
        return typedToValue<std::vector<uint64_t>>(v);
    case T::FLOAT_ARRAY:
        return typedToValue<std::vector<float>>(v);
    case T::DOUBLE_ARRAY:
        return typedToValue<std::vector<double>>(v);
    case T::STRING_ARRAY:
        return typedToValue<std::vector<std::string>>(v);
    default:
        return std::nullopt;
    }
}

template <class T> std::unique_ptr<DataPointValue> typed(const std::string& path, const Value& v) {
    return std::make_unique<velocitas::TypedDataPointValue<T>>(path, From<T>::get(v));
}

/** Runtime value of VSS type `type` ⇒ SDK value to set (actuators are never arrays, ADR-0018). */
std::unique_ptr<DataPointValue> toSdk(const std::string& path, const std::string& type, const Value& v) {
    if (type == "boolean") {
        return typed<bool>(path, v);
    }
    if (type == "int8") {
        return typed<int8_t>(path, v);
    }
    if (type == "int16") {
        return typed<int16_t>(path, v);
    }
    if (type == "int32") {
        return typed<int32_t>(path, v);
    }
    if (type == "int64") {
        return typed<int64_t>(path, v);
    }
    if (type == "uint8") {
        return typed<uint8_t>(path, v);
    }
    if (type == "uint16") {
        return typed<uint16_t>(path, v);
    }
    if (type == "uint32") {
        return typed<uint32_t>(path, v);
    }
    if (type == "uint64") {
        return typed<uint64_t>(path, v);
    }
    if (type == "float") {
        return typed<float>(path, v);
    }
    if (type == "double") {
        return typed<double>(path, v);
    }
    if (type == "string") {
        return typed<std::string>(path, v);
    }
    throw std::invalid_argument("simvehicleapp runtime: cannot write " + path + " of type " + type);
}

} // namespace

// ---- VelocitasVehicleAccess -----------------------------------------------------------------------

VelocitasVehicleAccess::VelocitasVehicleAccess(std::shared_ptr<velocitas::IVehicleDataBrokerClient> vdb,
                                               Strand& strand)
    : m_vdb(std::move(vdb))
    , m_strand(strand) {}

std::optional<Value> VelocitasVehicleAccess::current(const std::string& path, const std::string& type) {
    (void)type;
    try {
        // Before the app starts (not on the strand): blocking is fine here.
        const auto reply = m_vdb->getDatapoints({path})->await();
        return fromSdk(*reply.getUntyped(path));
    } catch (const std::exception& e) {
        velocitas::logger().warn("simvehicleapp: no current value of {}: {}", path, e.what());
        return std::nullopt;
    }
}

void VelocitasVehicleAccess::subscribe(const std::string& path, const std::string& type,
                                       std::function<void(const Value&)> onValue) {
    (void)type;
    auto sub = m_vdb->subscribe("SELECT " + path);
    sub->onItem([this, path, onValue](const velocitas::DataPointReply& reply) {
           std::optional<Value> v;
           try {
               v = fromSdk(*reply.getUntyped(path));
           } catch (const std::exception&) {
               return; // the reply does not carry this path
           }
           if (v) {
               m_strand.post([onValue, value = *v] { onValue(value); });
           }
       })
        ->onError([path](const velocitas::Status& status) {
            velocitas::logger().error("simvehicleapp: subscription to {} failed: {}", path, status.errorMessage());
        });
    std::lock_guard<std::mutex> lock(m_mutex);
    m_subscriptions.push_back(std::move(sub));
}

void VelocitasVehicleAccess::get(const std::string& path, const std::string& type,
                                 std::function<void(std::optional<Value>, const std::string&)> done) {
    (void)type;
    m_vdb->getDatapoints({path})
        ->onResult([this, path, done](const velocitas::DataPointReply& reply) {
            std::optional<Value> v;
            try {
                v = fromSdk(*reply.getUntyped(path));
            } catch (const std::exception&) {
            }
            m_strand.post([done, v] { done(v, ""); });
        })
        ->onError([this, done](const velocitas::Status& status) {
            m_strand.post([done, msg = status.errorMessage()] { done(std::nullopt, msg); });
        });
}

void VelocitasVehicleAccess::set(const std::string& path, const std::string& type, const Value& value,
                                 std::function<void(const std::string&)> done) {
    std::vector<std::unique_ptr<DataPointValue>> batch;
    batch.push_back(toSdk(path, type, value));
    m_vdb->setDatapoints(batch)
        ->onResult([this, path, done](const velocitas::IVehicleDataBrokerClient::SetErrorMap_t& errors) {
            std::string err;
            if (auto it = errors.find(path); it != errors.end()) {
                err = it->second;
            } else if (!errors.empty()) {
                err = errors.begin()->second;
            }
            if (!err.empty()) {
                velocitas::logger().error("simvehicleapp: set {} failed: {}", path, err);
            }
            if (done) {
                m_strand.post([done, err] { done(err); });
            }
        })
        ->onError([this, path, done](const velocitas::Status& status) {
            velocitas::logger().error("simvehicleapp: set {} failed: {}", path, status.errorMessage());
            if (done) {
                m_strand.post([done, msg = status.errorMessage()] { done(msg); });
            }
        });
}

// ---- VelocitasPubSub ------------------------------------------------------------------------------

VelocitasPubSub::VelocitasPubSub(std::shared_ptr<velocitas::IPubSubClient> client, Strand& strand)
    : m_client(std::move(client))
    , m_strand(strand) {}

void VelocitasPubSub::setHandler(Handler handler) { m_handler = std::move(handler); }

void VelocitasPubSub::subscribe(const std::string& filter) {
    if (!m_client) {
        return;
    }
    auto sub = m_client->subscribeTopic(filter);
    // The SDK gives the payload only: deliver it to the triggers of this exact subscription.
    sub->onItem([this, filter](const std::string& payload) {
           m_strand.post([this, filter, payload] {
               if (m_handler) {
                   m_handler(filter, payload, &filter);
               }
           });
       })
        ->onError([filter](const velocitas::Status& status) {
            velocitas::logger().error("simvehicleapp: MQTT subscription {} failed: {}", filter, status.errorMessage());
        });
    m_subscriptions.push_back(std::move(sub));
}

void VelocitasPubSub::publish(const std::string& topic, const std::string& payload) {
    if (m_client) {
        m_client->publishOnTopic(topic, payload);
    }
}

// ---- AppBase -----------------------------------------------------------------------------------------

AppBase::AppBase(const std::string& appName, TraceLevel defaultLevel)
    : VehicleApp(velocitas::IVehicleDataBrokerClient::createInstance("vehicledatabroker"),
                 velocitas::IPubSubClient::createInstance(appName))
    , m_appName(appName)
    , m_strand(m_clock)
    , m_sink(appName, StdoutTraceSink::levelFromEnv(defaultLevel)) {}

AppBase::~AppBase() {
    m_strand.stop();
    if (m_loop.joinable()) {
        if (m_loop.get_id() == std::this_thread::get_id()) {
            m_loop.detach();
        } else {
            m_loop.join();
        }
    }
}

void AppBase::onStart() {
    m_vehicle = std::make_unique<VelocitasVehicleAccess>(getVehicleDataBrokerClient(), m_strand);
    m_pubsub = std::make_unique<VelocitasPubSub>(getPubSubClient(), m_strand);
    m_runtime = std::make_unique<Runtime>(m_strand, *m_vehicle, *m_pubsub, m_sink);
    bindWorkflows(*m_runtime);
    m_sink.trace(TraceRecord{0, epochMs(), "vdb.connected", "", std::nullopt, "", "", std::nullopt});
    onAppStart();
    m_runtime->start();
    m_sink.trace(TraceRecord{0, epochMs(), "app.started", "", std::nullopt, "", "", std::nullopt});
    m_loop = std::thread([this] {
        m_strand.run();
        if (m_runtime && m_runtime->stopped()) {
            // A `stop` block with scope "app" ended the strand: stop the whole app.
            stop();
        }
    });
}

void AppBase::onStop() {
    m_sink.trace(TraceRecord{0, epochMs(), "app.stopping", "", std::nullopt, "", "", std::nullopt});
    onAppStop();
    if (m_runtime) {
        m_runtime->stopAll();
    }
    m_strand.stop();
    if (m_loop.joinable() && m_loop.get_id() != std::this_thread::get_id()) {
        m_loop.join();
    }
}

} // namespace simvehicleapp::rt
