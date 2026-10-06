// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0

#ifndef SIMVEHICLEAPP_RT_VELOCITAS_HPP
#define SIMVEHICLEAPP_RT_VELOCITAS_HPP

#include "simvehicleapp/rt/Runtime.hpp"

#include "sdk/AsyncResult.h"
#include "sdk/IPubSubClient.h"
#include "sdk/VehicleApp.h"
#include "sdk/vdb/IVehicleDataBrokerClient.h"

#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

/**
 * The only part of the runtime that uses the Velocitas SDK (ADR-0021 §3–4): signals go through
 * `IVehicleDataBrokerClient` by path, MQTT through `IPubSubClient`; every SDK callback is posted
 * to the strand, nothing awaits on it.
 */
namespace simvehicleapp::rt {

class VelocitasVehicleAccess final : public IVehicleAccess {
public:
    VelocitasVehicleAccess(std::shared_ptr<velocitas::IVehicleDataBrokerClient> vdb, Strand& strand);

    std::optional<Value> current(const std::string& path, const std::string& type) override;
    void subscribe(const std::string& path, const std::string& type, std::function<void(const Value&)> onValue) override;
    void get(const std::string& path, const std::string& type,
             std::function<void(std::optional<Value>, const std::string&)> done) override;
    void set(const std::string& path, const std::string& type, const Value& value,
             std::function<void(const std::string&)> done) override;

private:
    std::shared_ptr<velocitas::IVehicleDataBrokerClient> m_vdb;
    Strand& m_strand;
    std::mutex m_mutex;
    std::vector<velocitas::AsyncSubscriptionPtr_t<velocitas::DataPointReply>> m_subscriptions;
};

class VelocitasPubSub final : public IPubSub {
public:
    VelocitasPubSub(std::shared_ptr<velocitas::IPubSubClient> client, Strand& strand);

    void setHandler(Handler handler) override;
    void subscribe(const std::string& filter) override;
    void publish(const std::string& topic, const std::string& payload) override;

private:
    std::shared_ptr<velocitas::IPubSubClient> m_client;
    Strand& m_strand;
    Handler m_handler;
    std::vector<velocitas::AsyncSubscriptionPtr_t<std::string>> m_subscriptions;
};

/**
 * Host of a generated app (`SimVehicleApp : AppBase`): connects to the databroker
 * ("vehicledatabroker") and MQTT like the template's SampleApp, then runs the workflows on a strand
 * thread. Trace goes to stdout (`SVTRACE`, level from `SV_TRACE_LEVEL`).
 */
class AppBase : public velocitas::VehicleApp {
public:
    /** `defaultLevel`: trace level of the project; env `SV_TRACE_LEVEL` overrides it. */
    explicit AppBase(const std::string& appName, TraceLevel defaultLevel = TraceLevel::Node);
    ~AppBase() override;

    void onStart() final;
    void onStop() override;

protected:
    /** Declares the workflows (generated). */
    virtual void bindWorkflows(Runtime& rt) = 0;
    /** User hooks (`app/src/user/UserHooks.*`), called around the workflows. */
    virtual void onAppStart() {}
    virtual void onAppStop() {}

private:
    std::string m_appName;
    SteadyClock m_clock;
    Strand m_strand;
    StdoutTraceSink m_sink;
    std::unique_ptr<VelocitasVehicleAccess> m_vehicle;
    std::unique_ptr<VelocitasPubSub> m_pubsub;
    std::unique_ptr<Runtime> m_runtime;
    std::thread m_loop;
};

} // namespace simvehicleapp::rt

#endif // SIMVEHICLEAPP_RT_VELOCITAS_HPP
