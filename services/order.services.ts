import { NextFunction, Response } from "express";
import { CatchAsyncError } from "../middleware/catchAsyncErrors";
import OrderModel, { IOrder } from "../models/order.model";

//create new order
export const newOrder = CatchAsyncError(async(data:any, next:NextFunction, res: Response) => {
    const order = await OrderModel.create(data);

    res.status(201).json({
        success: true,
        order
    });
});

// get all orders
export const getAllOrdersService = async (res:Response) => {
    const users = await OrderModel.find().sort({ createdAt: -1 });

    res.status(201).json({
        success: true,
        users,
    })
}