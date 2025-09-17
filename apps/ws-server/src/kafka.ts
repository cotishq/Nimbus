import { Kafka, Producer } from "kafkajs";



const kafka = new Kafka({
    clientId: "ws-server",
    brokers : [process.env.KAFKA_BROKER || "localhost:9092"],
});

let producer : Producer | null = null;

export async function getKafkaProducer() {
    if(producer) return producer;
    producer = kafka.producer();
    await producer.connect();
    console.log("Kafka producer connected");
    return producer;
    
}